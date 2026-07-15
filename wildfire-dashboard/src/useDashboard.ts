import { useCallback, useEffect, useState } from 'react'
import { mockAlerts, mockNodes, mockReadings } from './mockData'
import { getTimeRange, type TimeRangeKey } from './timeRanges'
import type {
  Alert,
  GpsReacquireCommand,
  ManualLocationInput,
  NodeStatus,
  Reading,
} from './types'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`API ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function deleteJson(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(`API ${response.status}`)
  }
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`API ${response.status}`)
  }

  return response.json() as Promise<T>
}

function mergeLatestReadings(nodes: NodeStatus[], latestReadings: Reading[]) {
  const latestByNode = new Map(latestReadings.map((reading) => [reading.node_id, reading]))
  const latestValue = <T extends keyof Reading, Fallback>(
    latest: Reading,
    key: T,
    fallback: Fallback,
  ) => (Object.prototype.hasOwnProperty.call(latest, key) ? latest[key] : fallback)

  return nodes.map((node) => {
    const latest = latestByNode.get(node.node_id)
    if (!latest) return node

    return {
      ...node,
      state: latest.server_state ?? latest.state ?? node.state,
      confidence: latest.confidence ?? node.confidence,
      node_state: latest.node_state ?? node.node_state,
      node_confidence: latest.node_confidence ?? node.node_confidence,
      server_state: latest.server_state ?? node.server_state,
      server_risk_score: latest.server_risk_score ?? node.server_risk_score,
      server_reasons: latest.server_reasons ?? node.server_reasons,
      fire_danger_level: latest.fire_danger_level ?? node.fire_danger_level,
      air_temp: latestValue(latest, 'air_temp', node.air_temp),
      humidity: latestValue(latest, 'humidity', node.humidity),
      smoke_raw: latestValue(latest, 'smoke_raw', node.smoke_raw),
      sensor_health: latest.sensor_health ?? node.sensor_health,
      rssi: latest.rssi ?? node.rssi,
      snr: latest.snr ?? node.snr,
      last_seen: latest.timestamp ?? node.last_seen,
      last_seq: latest.seq ?? node.last_seq,
    }
  })
}

export function useDashboard(selectedNodeId: string, timeRange: TimeRangeKey) {
  const [nodes, setNodes] = useState<NodeStatus[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [demoMode, setDemoMode] = useState(false)
  const [apiError, setApiError] = useState<string>()
  const [lastUpdated, setLastUpdated] = useState<Date>()

  const load = useCallback(async () => {
    try {
      const selectedRange = getTimeRange(timeRange)
      const from = new Date(Date.now() - selectedRange.hours * 60 * 60 * 1000).toISOString()
      const [nodeData, alertData, latestReadings] = await Promise.all([
        getJson<NodeStatus[]>('/nodes'),
        getJson<Alert[]>('/alerts?limit=12'),
        getJson<Reading[]>('/readings/latest'),
      ])
      const readingData = selectedNodeId
        ? await getJson<Reading[]>(
            `/readings/${encodeURIComponent(selectedNodeId)}?from=${encodeURIComponent(from)}&limit=${selectedRange.apiLimit}`,
          )
        : []

      setNodes(mergeLatestReadings(nodeData, latestReadings))
      setAlerts(alertData)
      setReadings(readingData.reverse())
      setDemoMode(false)
      setApiError(undefined)
    } catch (error) {
      setNodes(mockNodes)
      setAlerts(mockAlerts)
      setReadings(mockReadings[selectedNodeId] ?? mockReadings.NODE01)
      setDemoMode(true)
      setApiError(error instanceof Error ? error.message : 'API unavailable')
    } finally {
      setLoading(false)
      setLastUpdated(new Date())
    }
  }, [selectedNodeId, timeRange])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 5_000)
    return () => window.clearInterval(timer)
  }, [load])

  const deleteAlert = useCallback(
    async (alertId: string) => {
      setAlerts((current) => current.filter((alert) => alert._id !== alertId))

      try {
        await deleteJson(`/alerts/${encodeURIComponent(alertId)}`)
        await load()
      } catch (error) {
        await load()
        throw error
      }
    },
    [load],
  )

  const reacquireGps = useCallback(
    async (nodeId: string) => {
      const command = await postJson<GpsReacquireCommand>(
        `/nodes/${encodeURIComponent(nodeId)}/gps/reacquire`,
      )
      await load()
      return command
    },
    [load],
  )

  const saveManualLocation = useCallback(
    async (nodeId: string, location: ManualLocationInput) => {
      const node = await postJson<NodeStatus>(
        `/nodes/${encodeURIComponent(nodeId)}/location/manual`,
        location,
      )
      await load()
      return node
    },
    [load],
  )

  return {
    nodes,
    alerts,
    readings,
    loading,
    demoMode,
    apiError,
    lastUpdated,
    refresh: load,
    deleteAlert,
    reacquireGps,
    saveManualLocation,
  }
}
