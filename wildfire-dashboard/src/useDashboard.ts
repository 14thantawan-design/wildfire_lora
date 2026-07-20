import { useCallback, useEffect, useRef, useState } from 'react'
import { getTimeRange, type TimeRangeKey } from './timeRanges'
import type {
  Alert,
  ApiHealth,
  GpsReacquireCommand,
  ManualLocationInput,
  NodeStatus,
  Reading,
} from './types'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal,
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
      battery_v: latestValue(latest, 'battery_v', node.battery_v),
      battery_percent: latestValue(latest, 'battery_percent', node.battery_percent),
      sensor_health: latest.sensor_health ?? node.sensor_health,
      rssi: node.rssi ?? latest.rssi,
      snr: node.snr ?? latest.snr,
      last_seen: node.last_seen,
      last_seq: node.last_seq,
    }
  })
}

export function useDashboard(selectedNodeId: string, timeRange: TimeRangeKey) {
  const [nodes, setNodes] = useState<NodeStatus[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [recentReadings, setRecentReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [backendUnavailable, setBackendUnavailable] = useState(false)
  const [health, setHealth] = useState<ApiHealth>()
  const [apiError, setApiError] = useState<string>()
  const [lastUpdated, setLastUpdated] = useState<Date>()
  const activeRequestRef = useRef<AbortController | undefined>(undefined)
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    activeRequestRef.current?.abort()
    const controller = new AbortController()
    activeRequestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 4_500)
    setLoading(true)

    try {
      const selectedRange = getTimeRange(timeRange)
      const from = new Date(Date.now() - selectedRange.hours * 60 * 60 * 1000).toISOString()
      const [nodeData, alertHistory, activeAlerts, latestReadings, healthData] = await Promise.all([
        getJson<NodeStatus[]>('/nodes', controller.signal),
        getJson<Alert[]>('/alerts?limit=50', controller.signal),
        getJson<Alert[]>('/alerts/active', controller.signal),
        getJson<Reading[]>('/readings/latest', controller.signal),
        getJson<ApiHealth>('/health', controller.signal),
      ])
      const effectiveNodeId = nodeData.some((node) => node.node_id === selectedNodeId)
        ? selectedNodeId
        : nodeData[0]?.node_id
      const bucketQuery = selectedRange.bucketMs ? `&bucket_ms=${selectedRange.bucketMs}` : ''
      const [readingData, recentReadingData] = effectiveNodeId
        ? await Promise.all([
            getJson<Reading[]>(
              `/readings/${encodeURIComponent(effectiveNodeId)}?from=${encodeURIComponent(from)}&limit=${selectedRange.apiLimit}${bucketQuery}`,
              controller.signal,
            ),
            getJson<Reading[]>(
              `/readings/${encodeURIComponent(effectiveNodeId)}?limit=10`,
              controller.signal,
            ),
          ])
        : [[], []]

      if (requestId !== requestIdRef.current) return
      const alertsById = new Map(alertHistory.map((alert) => [alert._id, alert]))
      activeAlerts.forEach((alert) => alertsById.set(alert._id, alert))
      setNodes(mergeLatestReadings(nodeData, latestReadings))
      setAlerts(
        [...alertsById.values()].sort(
          (first, second) => new Date(second.started_at).getTime() - new Date(first.started_at).getTime(),
        ),
      )
      setReadings(readingData.reverse())
      setRecentReadings(recentReadingData)
      setHealth(healthData)
      setBackendUnavailable(false)
      setApiError(undefined)
      setLastUpdated(new Date())
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      setBackendUnavailable(true)
      setApiError(error instanceof DOMException && error.name === 'AbortError'
        ? 'API timeout'
        : error instanceof Error ? error.message : 'API unavailable')
    } finally {
      window.clearTimeout(timeout)
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [selectedNodeId, timeRange])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 5_000)
    return () => {
      window.clearInterval(timer)
      requestIdRef.current += 1
      activeRequestRef.current?.abort()
    }
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
    recentReadings,
    loading,
    backendUnavailable,
    health,
    apiError,
    lastUpdated,
    refresh: load,
    deleteAlert,
    reacquireGps,
    saveManualLocation,
  }
}
