import { useCallback, useEffect, useRef, useState } from 'react'
import { getTimeRange, type TimeRangeKey } from './timeRanges'
import { selectLiveOverview } from './liveOverview'
import type {
  Alert,
  ApiHealth,
  BaselineRecalibrationStatus,
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
    const errorPayload = await response.json().catch(() => null) as
      | { message?: string; error?: string }
      | null
    throw new Error(errorPayload?.message || errorPayload?.error || `API ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function useDashboard(selectedNodeId: string, timeRange: TimeRangeKey) {
  const [nodes, setNodes] = useState<NodeStatus[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [recentReadings, setRecentReadings] = useState<Reading[]>([])
  const [backendUnavailable, setBackendUnavailable] = useState(false)
  const [health, setHealth] = useState<ApiHealth>()
  const activeRequestRef = useRef<AbortController | undefined>(undefined)
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    activeRequestRef.current?.abort()
    const controller = new AbortController()
    activeRequestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 4_500)

    try {
      const selectedRange = getTimeRange(timeRange)
      const from = new Date(Date.now() - selectedRange.hours * 60 * 60 * 1000).toISOString()
      const [nodeData, alertHistory, activeAlerts, healthData] = await Promise.all([
        getJson<NodeStatus[]>('/nodes', controller.signal),
        getJson<Alert[]>('/alerts?limit=50', controller.signal),
        getJson<Alert[]>('/alerts/active', controller.signal),
        getJson<ApiHealth>('/health', controller.signal),
      ])
      // History remains available through the readings API and Admin page.
      // Only currently online nodes participate in the live overview.
      const { liveNodes, effectiveNodeId } = selectLiveOverview(nodeData, selectedNodeId)
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
      setNodes(liveNodes)
      setAlerts(
        [...alertsById.values()].sort(
          (first, second) => new Date(second.started_at).getTime() - new Date(first.started_at).getTime(),
        ),
      )
      setReadings(readingData.reverse())
      setRecentReadings(recentReadingData)
      setHealth(healthData)
      setBackendUnavailable(false)
    } catch {
      if (requestId !== requestIdRef.current) return
      setBackendUnavailable(true)
    } finally {
      window.clearTimeout(timeout)
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

  const recalibrateBaseline = useCallback(
    async (nodeId: string) => postJson<BaselineRecalibrationStatus>(
      `/nodes/${encodeURIComponent(nodeId)}/baseline/recalibration`,
    ),
    [],
  )

  const getBaselineRecalibrationStatus = useCallback(
    async (nodeId: string) => getJson<BaselineRecalibrationStatus>(
      `/nodes/${encodeURIComponent(nodeId)}/baseline/recalibration`,
    ),
    [],
  )

  return {
    nodes,
    alerts,
    readings,
    recentReadings,
    backendUnavailable,
    health,
    refresh: load,
    deleteAlert,
    reacquireGps,
    recalibrateBaseline,
    getBaselineRecalibrationStatus,
    saveManualLocation,
  }
}
