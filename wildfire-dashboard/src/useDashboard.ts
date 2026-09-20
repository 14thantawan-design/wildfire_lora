/** Hook กลางสำหรับโหลดข้อมูล Dashboard และส่งคำสั่งที่ผู้ใช้กดกลับไปยัง Backend */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getTimeRange, type TimeRangeKey } from './timeRanges'
import { selectLiveOverview } from './liveOverview'
import type {
  Alert,
  ApiHealth,
  GpsReacquireCommand,
  ManualLocationInput,
  NodeStatus,
  Reading,
} from './types'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

/** เรียก GET API และคืน JSON ตามชนิดข้อมูลที่ผู้เรียกระบุ */
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

/** เรียก DELETE API สำหรับลบ Alert */
async function deleteJson(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(`API ${response.status}`)
  }
}

/** เรียก POST API สำหรับคำสั่ง GPS และพิกัดที่กรอกเอง */
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

/** จัดการข้อมูลสด การรีเฟรชทุก 5 วินาที และ action ทั้งหมดของหน้าภาพรวม */
export function useDashboard(selectedNodeId: string, timeRange: TimeRangeKey) {
  const [nodes, setNodes] = useState<NodeStatus[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [backendUnavailable, setBackendUnavailable] = useState(false)
  const [health, setHealth] = useState<ApiHealth>()
  const activeRequestRef = useRef<AbortController | undefined>(undefined)
  const requestIdRef = useRef(0)

  /** โหลด Node, Alert, Health และ Reading ของโหนดที่เลือกพร้อมกัน */
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
      // ประวัติย้อนหลังยังอ่านได้จาก Readings API และหน้า Admin
      // ส่วนภาพรวมข้อมูลสดใช้เฉพาะโหนดที่ออนไลน์อยู่ในขณะนี้
      const { liveNodes, effectiveNodeId } = selectLiveOverview(nodeData, selectedNodeId)
      const bucketQuery = selectedRange.bucketMs ? `&bucket_ms=${selectedRange.bucketMs}` : ''
      const readingData = effectiveNodeId
        ? await getJson<Reading[]>(
            `/readings/${encodeURIComponent(effectiveNodeId)}?from=${encodeURIComponent(from)}&limit=${selectedRange.apiLimit}${bucketQuery}`,
            controller.signal,
          )
        : []

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

  return {
    nodes,
    alerts,
    readings,
    backendUnavailable,
    health,
    refresh: load,
    deleteAlert,
    reacquireGps,
    saveManualLocation,
  }
}
