import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  Database,
  Droplets,
  Flame,
  History,
  MapPin,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  Trash2,
  TriangleAlert,
  Wind,
  X,
} from 'lucide-react'
import { AdminReadingsPage } from './AdminReadingsPage'
import type { Alert, NodeState } from './types'
import { useDashboard } from './useDashboard'
import type { TimeRangeKey } from './timeRanges'
import { stateLabels } from './nodeStates'
import { assessLiveSafety } from './liveOverview'
import './App.css'

const MapPanel = lazy(() =>
  import('./MapPanel').then((module) => ({ default: module.MapPanel })),
)
const TrendChart = lazy(() =>
  import('./TrendChart').then((module) => ({ default: module.TrendChart })),
)

const ADMIN_HOSTNAME = (import.meta.env.VITE_ADMIN_HOSTNAME || 'admin.nattaphat.me').toLowerCase()
const MANUAL_LOCATION_HISTORY_KEY = 'forestguard.manual-location-history.v1'
const MANUAL_LOCATION_HISTORY_LIMIT = 3

type ManualLocationHistoryEntry = {
  nodeId: string
  latitude: number
  longitude: number
  savedAt: string
}

function isManualLocationHistoryEntry(value: unknown): value is ManualLocationHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ManualLocationHistoryEntry>
  return (
    typeof entry.nodeId === 'string'
    && typeof entry.latitude === 'number'
    && Number.isFinite(entry.latitude)
    && entry.latitude >= -90
    && entry.latitude <= 90
    && typeof entry.longitude === 'number'
    && Number.isFinite(entry.longitude)
    && entry.longitude >= -180
    && entry.longitude <= 180
    && typeof entry.savedAt === 'string'
  )
}

function loadManualLocationHistory() {
  if (typeof window === 'undefined') return []
  try {
    const storedHistory: unknown = JSON.parse(
      window.localStorage.getItem(MANUAL_LOCATION_HISTORY_KEY) ?? '[]',
    )
    return Array.isArray(storedHistory)
      ? storedHistory.filter(isManualLocationHistoryEntry).slice(0, MANUAL_LOCATION_HISTORY_LIMIT)
      : []
  } catch {
    return []
  }
}

function formatTime(value?: string | Date) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function timeAgo(value?: string) {
  if (!value) return 'ยังไม่มีข้อมูล'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds} วินาทีที่แล้ว`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  return `${Math.floor(minutes / 60)} ชั่วโมงที่แล้ว`
}

function hasValidCoordinates(latitude?: number, longitude?: number) {
  return typeof latitude === 'number' && Number.isFinite(latitude) &&
    typeof longitude === 'number' && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180 &&
    (Math.abs(latitude) >= 0.000001 || Math.abs(longitude) >= 0.000001)
}

function Value({
  value,
  suffix,
  fractionDigits,
}: {
  value?: number | null
  suffix?: string
  fractionDigits?: number
}) {
  const hasValue = value !== undefined && value !== null
  const digits = fractionDigits ?? (hasValue && Number.isInteger(value) ? 0 : 1)
  const displayValue = hasValue
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '—'

  return (
    <>
      <span className="metric-number">{displayValue}</span>
      {hasValue && suffix && <small>{suffix.trim()}</small>}
    </>
  )
}

function safetyBannerFor(canAssess: boolean, state: NodeState) {
  if (!canAssess || state === 'UNKNOWN') {
    return {
      tone: 'unknown',
      heading: 'ยังประเมินสถานการณ์ไม่ได้',
      message: 'ข้อมูลสดจาก Gateway หรือจุดตรวจวัดไม่พร้อม',
    }
  }

  if (state === 'WATCH') {
    return {
      tone: 'watch',
      heading: 'สถานการณ์ต้องเฝ้าติดตาม',
      message: 'เริ่มพบสัญญาณผิดปกติ ควรติดตามอย่างใกล้ชิด',
    }
  }

  if (state === 'SENSOR_FAULT') {
    return {
      tone: 'danger',
      heading: 'ต้องตรวจสอบอุปกรณ์',
      message: 'พบจุดตรวจวัดที่มีเซนเซอร์ขัดข้อง',
    }
  }

  if (state === 'WARNING') {
    return {
      tone: 'danger',
      heading: 'ต้องตรวจสอบทันที',
      message: 'พบจุดตรวจวัดที่อยู่ในระดับเตือนภัย',
    }
  }

  return {
    tone: 'safe',
    heading: 'สถานการณ์จากจุดตรวจออนไลน์',
    message: 'ค่าที่โหนดตรวจวัดยังอยู่ในเกณฑ์ความเสี่ยงระดับปกติ',
  }
}

function formatAlertSummary(alert: Alert) {
  const reading = alert.last_reading
  if (!reading) return `โหนดรายงานสถานะ ${stateLabels[alert.level]}`

  const values = [
    typeof reading.air_temp === 'number' ? `${reading.air_temp.toFixed(1)}°C` : undefined,
    typeof reading.humidity === 'number' ? `${reading.humidity.toFixed(1)}%RH` : undefined,
    typeof reading.particle_ug_m3 === 'number'
      ? `${reading.particle_ug_m3.toFixed(1)} µg/m³`
      : undefined,
  ].filter(Boolean)

  return values.length > 0
    ? `${stateLabels[alert.level]} · ${values.join(' · ')}`
    : `โหนดรายงานสถานะ ${stateLabels[alert.level]}`
}

function App() {
  const [selectedNodeId, setSelectedNodeId] = useState('NODE01')
  const [showAllAlerts, setShowAllAlerts] = useState(false)
  const [chartRange, setChartRange] = useState<TimeRangeKey>('1h')
  const currentHostname = window.location.hostname.toLowerCase()
  const adminMode = currentHostname === ADMIN_HOSTNAME ||
    currentHostname === 'localhost' ||
    currentHostname === '127.0.0.1'
  const [adminDataOpen, setAdminDataOpen] = useState(
    () => adminMode && window.location.hash === '#admin-data',
  )
  const [deletingAlertId, setDeletingAlertId] = useState<string>()
  const [gpsRequestingNodeId, setGpsRequestingNodeId] = useState<string>()
  const [gpsRequestError, setGpsRequestError] = useState<{ nodeId: string; message: string }>()
  const [mapFocusRequest, setMapFocusRequest] = useState<{ nodeId: string; requestId: number }>()
  const [mapLocateError, setMapLocateError] = useState<{ nodeId: string; message: string }>()
  const [manualLocation, setManualLocation] = useState<{
    nodeId: string
    latitude: string
    longitude: string
  }>()
  const [manualLocationSaving, setManualLocationSaving] = useState(false)
  const [manualLocationError, setManualLocationError] = useState<string>()
  const [manualLocationHistory, setManualLocationHistory] = useState<ManualLocationHistoryEntry[]>(
    loadManualLocationHistory,
  )
  const {
    nodes,
    alerts,
    readings,
    backendUnavailable,
    health,
    refresh,
    deleteAlert,
    reacquireGps,
    saveManualLocation,
  } = useDashboard(selectedNodeId, chartRange)

  const selectedNode = nodes.find((node) => node.node_id === selectedNodeId) ?? nodes[0]
  useEffect(() => {
    if (nodes.length > 0 && !nodes.some((node) => node.node_id === selectedNodeId)) {
      setSelectedNodeId(nodes[0].node_id)
    }
  }, [nodes, selectedNodeId])

  const onlineNodes = nodes.filter((node) => node.online)
  const liveNodeIds = new Set(onlineNodes.map((node) => node.node_id))
  const gatewayConnected = !backendUnavailable && Boolean(health?.gateway.connected)
  const selectedLiveNode = gatewayConnected && selectedNode?.online ? selectedNode : undefined
  const selectedParticle = selectedLiveNode?.particle_ug_m3
  const selectedMetricMeta = selectedLiveNode?.last_seen
    ? `${selectedLiveNode.node_id} · ${timeAgo(selectedLiveNode.last_seen)}`
    : 'ยังไม่มีข้อมูลสดจากโหนดที่เลือก'
  const { highestState, canAssessSafety } = assessLiveSafety(nodes, health, backendUnavailable)
  const safetyBanner = safetyBannerFor(canAssessSafety, highestState)
  const visibleAlerts = showAllAlerts ? alerts : alerts.slice(0, 5)
  const hiddenAlertCount = Math.max(0, alerts.length - visibleAlerts.length)
  const gpsRequesting = gpsRequestingNodeId === selectedNode?.node_id
  const gpsStatus = (() => {
    if (!selectedNode) return { tone: 'muted', text: 'ยังไม่มีจุดตรวจ' }
    if (gpsRequesting) return { tone: 'searching', text: `${selectedNode.node_id} · กำลังส่งคำสั่ง` }
    if (gpsRequestError?.nodeId === selectedNode.node_id) {
      return { tone: 'error', text: gpsRequestError.message }
    }
    if (selectedNode.location_source === 'manual') {
      if (selectedNode.gps_error === 'gps_reacquiring') {
        return { tone: 'searching', text: `${selectedNode.node_id} · ใช้พิกัดที่กรอก · กำลังหา GPS` }
      }
      if (selectedNode.gps_error === 'gps_failed') {
        return { tone: 'manual', text: `${selectedNode.node_id} · พิกัดกำหนดเอง · GPS ไม่พร้อม` }
      }
      return { tone: 'manual', text: `${selectedNode.node_id} · พิกัดกำหนดเอง` }
    }
    if (selectedNode.gps_error === 'gps_reacquiring') {
      return { tone: 'searching', text: `${selectedNode.node_id} · รอพิกัดใหม่` }
    }
    if (selectedNode.gps_error === 'gps_failed') {
      return { tone: 'error', text: `${selectedNode.node_id} · ยังหา GPS ไม่พบ` }
    }
    if (selectedNode.gps_fixed) {
      return { tone: 'ready', text: `${selectedNode.node_id} · GPS พร้อม` }
    }
    return { tone: 'muted', text: `${selectedNode.node_id} · ยังไม่มีพิกัด GPS` }
  })()

  const selectMapNode = (nodeId: string) => {
    setSelectedNodeId(nodeId)
    setGpsRequestError(undefined)
    setMapFocusRequest(undefined)
    setMapLocateError(undefined)
  }

  const locateSelectedNode = () => {
    if (!selectedNode) return
    if (!hasValidCoordinates(selectedNode.lat, selectedNode.lng)) {
      setMapLocateError({
        nodeId: selectedNode.node_id,
        message: `${selectedNode.node_id} ยังไม่มีข้อมูลตำแหน่ง`,
      })
      return
    }

    setMapLocateError(undefined)
    setMapFocusRequest({ nodeId: selectedNode.node_id, requestId: Date.now() })
    window.requestAnimationFrame(() => {
      document.querySelector('#map')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const removeAlert = (alertId: string) => {
    const alert = alerts.find((item) => item._id === alertId)
    const label = alert ? `${stateLabels[alert.level]} · ${alert.node_id}` : 'เหตุการณ์นี้'
    if (!window.confirm(`ลบประวัติ ${label} อย่างถาวรหรือไม่`)) return
    setDeletingAlertId(alertId)
    void deleteAlert(alertId).finally(() => setDeletingAlertId(undefined))
  }

  const requestSelectedNodeGps = async () => {
    if (!selectedNode) return

    setGpsRequestingNodeId(selectedNode.node_id)
    setGpsRequestError(undefined)
    try {
      await reacquireGps(selectedNode.node_id)
    } catch {
      setGpsRequestError({
        nodeId: selectedNode.node_id,
        message: `${selectedNode.node_id} · ส่งคำสั่งไม่สำเร็จ`,
      })
    } finally {
      setGpsRequestingNodeId(undefined)
    }
  }

  const openManualLocation = () => {
    if (!selectedNode) return
    setManualLocation({
      nodeId: selectedNode.node_id,
      latitude: selectedNode.lat?.toFixed(6) ?? '',
      longitude: selectedNode.lng?.toFixed(6) ?? '',
    })
    setManualLocationError(undefined)
  }

  const closeManualLocation = () => {
    if (manualLocationSaving) return
    setManualLocation(undefined)
    setManualLocationError(undefined)
  }

  const selectManualLocationHistory = (entry: ManualLocationHistoryEntry) => {
    setManualLocation((current) => current
      ? {
          ...current,
          latitude: entry.latitude.toFixed(6),
          longitude: entry.longitude.toFixed(6),
        }
      : current)
    setManualLocationError(undefined)
  }

  const rememberManualLocation = (entry: ManualLocationHistoryEntry) => {
    setManualLocationHistory((current) => {
      const nextHistory = [
        entry,
        ...current.filter((item) =>
          item.latitude !== entry.latitude || item.longitude !== entry.longitude,
        ),
      ].slice(0, MANUAL_LOCATION_HISTORY_LIMIT)

      try {
        window.localStorage.setItem(
          MANUAL_LOCATION_HISTORY_KEY,
          JSON.stringify(nextHistory),
        )
      } catch {
        // The saved location still succeeds when browser storage is unavailable.
      }

      return nextHistory
    })
  }

  const submitManualLocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!manualLocation) return

    const latitude = Number(manualLocation.latitude)
    const longitude = Number(manualLocation.longitude)
    const coordinatesValid =
      manualLocation.latitude.trim() !== ''
      && manualLocation.longitude.trim() !== ''
      && Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && latitude >= -90
      && latitude <= 90
      && longitude >= -180
      && longitude <= 180
      && (Math.abs(latitude) >= 0.000001 || Math.abs(longitude) >= 0.000001)

    if (!coordinatesValid) {
      setManualLocationError('กรุณาตรวจสอบละติจูดและลองจิจูดอีกครั้ง')
      return
    }

    setManualLocationSaving(true)
    setManualLocationError(undefined)
    try {
      await saveManualLocation(manualLocation.nodeId, { lat: latitude, lng: longitude })
      rememberManualLocation({
        nodeId: manualLocation.nodeId,
        latitude,
        longitude,
        savedAt: new Date().toISOString(),
      })
      setManualLocation(undefined)
    } catch {
      setManualLocationError('บันทึกพิกัดไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setManualLocationSaving(false)
    }
  }

  useEffect(() => {
    const syncAdminPageWithHash = () => {
      setAdminDataOpen(adminMode && window.location.hash === '#admin-data')
    }
    window.addEventListener('hashchange', syncAdminPageWithHash)
    return () => window.removeEventListener('hashchange', syncAdminPageWithHash)
  }, [adminMode])

  useEffect(() => {
    if (!manualLocation) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !manualLocationSaving) {
        setManualLocation(undefined)
        setManualLocationError(undefined)
      }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [manualLocation, manualLocationSaving])

  return (
    <div className="app-shell">
      <main>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark"><Flame size={22} /></span>
            <div>
              <strong>FOREST<span>GUARD</span></strong>
              <small>LoRa early warning</small>
            </div>
          </div>

          <div className={`gateway-card ${gatewayConnected ? '' : 'disconnected'}`}>
            <span className="gateway-icon"><RadioTower size={18} /></span>
            <div>
              <strong>LoRa Gateway</strong>
              <small><i /> {gatewayConnected ? 'เชื่อมต่อระบบ' : 'ไม่ได้รับสัญญาณ'}</small>
            </div>
          </div>

          <div className="topbar-actions">
            {adminMode && (
              <a
                aria-current={adminDataOpen ? 'page' : undefined}
                className={`admin-data-link ${adminDataOpen ? 'active' : ''}`}
                href={adminDataOpen ? '#overview' : '#admin-data'}
                title={adminDataOpen ? 'กลับหน้าภาพรวม' : 'จัดการข้อมูลที่ตรวจวัด'}
              >
                {adminDataOpen ? <ArrowLeft size={15} /> : <Database size={15} />}
                <span>{adminDataOpen ? 'กลับหน้าภาพรวม' : 'จัดการข้อมูล'}</span>
              </a>
            )}
          </div>
        </header>

        {adminDataOpen ? (
          <AdminReadingsPage onDataChanged={refresh} />
        ) : (
        <div className="content" id="overview">
          <section className="page-heading">
            <div>
              <span className="eyebrow">ศูนย์เฝ้าระวังภาคสนาม</span>
              <h1>ภาพรวมพื้นที่ตรวจวัด</h1>
              <p>ติดตามอุณหภูมิ ความชื้น และอนุภาคควันจากเครือข่าย LoRa</p>
            </div>
            <div className="date-chip">
              <span>{new Intl.DateTimeFormat('th-TH', { weekday: 'long' }).format(new Date())}</span>
              <strong>{new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</strong>
            </div>
          </section>

          <section className={`safety-banner ${safetyBanner.tone}`}>
            <span className="safety-icon">
              {safetyBanner.tone === 'safe' ? <ShieldCheck size={27} /> : <TriangleAlert size={27} />}
            </span>
            <div>
              <span>{safetyBanner.heading}</span>
              <strong>{safetyBanner.message}</strong>
            </div>
            <span className="safety-detail">
              {!canAssessSafety ? 'ตรวจสอบการเชื่อมต่อระบบ' : (
                <>ประเมินจาก {onlineNodes.length} จุด · ระดับสูงสุด <b className={`text-${highestState.toLowerCase()}`}>{stateLabels[highestState]}</b></>
              )}
            </span>
          </section>

          <section className="stat-grid">
            <article>
              <span className="stat-icon green"><RadioTower size={19} /></span>
              <div><span>โหนดออนไลน์</span><strong>{onlineNodes.length}<small> จุด</small></strong></div>
              <em>แสดงเฉพาะโหนดที่ส่งข้อมูลอยู่</em>
            </article>
            <article>
              <span className="stat-icon red"><Thermometer size={19} /></span>
              <div><span>อุณหภูมิล่าสุด</span><strong><Value value={selectedLiveNode?.air_temp} suffix="°C" fractionDigits={1} /></strong></div>
              <em>{selectedMetricMeta}</em>
            </article>
            <article>
              <span className="stat-icon blue"><Droplets size={19} /></span>
              <div><span>ความชื้นล่าสุด</span><strong><Value value={selectedLiveNode?.humidity} suffix="%" fractionDigits={1} /></strong></div>
              <em>{selectedMetricMeta}</em>
            </article>
            <article>
              <span className="stat-icon amber"><Wind size={19} /></span>
              <div><span>อนุภาคล่าสุด</span><strong><Value value={selectedParticle} suffix=" µg/m³" fractionDigits={1} /></strong></div>
              <em>{selectedMetricMeta}</em>
            </article>
          </section>

          <section className="dashboard-grid">
            <article className="panel map-panel" id="map">
              <div className="panel-head">
                <div><h2>แผนที่จุดตรวจวัด</h2></div>
                <div className="map-head-actions">
                  <label className="map-node-picker">
                    <span>จุดตรวจ</span>
                    <select
                      aria-label="เลือกจุดตรวจ"
                      value={selectedNode?.node_id ?? ''}
                      onChange={(event) => selectMapNode(event.target.value)}
                    >
                      {nodes.map((node) => (
                        <option key={node.node_id} value={node.node_id}>{node.node_id}</option>
                      ))}
                    </select>
                  </label>
                  <span className={`gps-state ${gpsStatus.tone}`}><i /> {gpsStatus.text}</span>
                  {adminMode && (
                    <div className="location-action-buttons">
                      <button
                        aria-label={`ค้นหา GPS ใหม่สำหรับ ${selectedNode?.node_id ?? 'จุดตรวจ'}`}
                        className="gps-refresh-button"
                        disabled={!selectedNode || backendUnavailable || gpsRequesting}
                        onClick={() => void requestSelectedNodeGps()}
                        title={backendUnavailable ? 'เชื่อมต่อ backend ก่อนจึงจะส่งคำสั่งได้' : 'ล้างพิกัดเดิมและค้นหา GPS ใหม่'}
                        type="button"
                      >
                        <RefreshCw className={gpsRequesting ? 'spin' : ''} size={14} />
                        <span>{gpsRequesting ? 'กำลังส่ง' : 'ค้นหา GPS ใหม่'}</span>
                      </button>
                      <button
                        aria-label={`กรอกพิกัดเองสำหรับ ${selectedNode?.node_id ?? 'จุดตรวจ'}`}
                        className="manual-location-button"
                        disabled={!selectedNode || backendUnavailable}
                        onClick={openManualLocation}
                        title={backendUnavailable ? 'เชื่อมต่อ backend ก่อนจึงจะบันทึกพิกัดได้' : 'กรอกพิกัดเอง'}
                        type="button"
                      >
                        <MapPin size={14} />
                        <span>กรอกพิกัด</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <Suspense fallback={<div className="panel-loading">กำลังโหลดแผนที่…</div>}>
                <MapPanel
                  focusRequest={mapFocusRequest}
                  nodes={nodes}
                  selectedNodeId={selectedNode?.node_id ?? ''}
                  onSelect={selectMapNode}
                />
              </Suspense>
            </article>

            <div className="dashboard-side-column">
              <aside
                aria-label="รายละเอียดของ Node"
                className="panel node-detail-card"
              >
                <div className="node-detail-head">
                  <span>
                    {nodes.length > 0 ? (
                      <select
                        aria-label="เลือก Node เพื่อดูรายละเอียด"
                        className="node-detail-select"
                        value={selectedNode?.node_id ?? ''}
                        onChange={(event) => setSelectedNodeId(event.target.value)}
                      >
                        {nodes.map((node) => (
                          <option key={node.node_id} value={node.node_id}>{node.node_id}</option>
                        ))}
                      </select>
                    ) : (
                      <strong>ยังไม่มีโหนด</strong>
                    )}
                  </span>
                  {selectedNode && (
                    <b className={`status-tag state-${selectedNode.online ? selectedNode.state.toLowerCase() : 'offline'}`}>
                      {selectedNode.online ? stateLabels[selectedNode.state] : 'ออฟไลน์'}
                    </b>
                  )}
                </div>
                <div className="node-map-locator">
                  <button
                    aria-controls="map"
                    aria-label={`ดูตำแหน่ง ${selectedNode?.node_id ?? 'Node'} บนแผนที่`}
                    disabled={!selectedNode}
                    onClick={locateSelectedNode}
                    type="button"
                  >
                    <MapPin size={15} />
                    <span>ดูตำแหน่งบนแผนที่</span>
                  </button>
                  {mapLocateError && mapLocateError.nodeId === selectedNode?.node_id && (
                    <small role="alert">{mapLocateError.message}</small>
                  )}
                </div>
              </aside>

              <article className="panel alert-panel" id="alerts">
              <div className="panel-head">
                <div><span className="panel-kicker">EVENTS</span><h2>เหตุการณ์ล่าสุด</h2></div>
                {alerts.length > 5 && (
                  <button
                    aria-expanded={showAllAlerts}
                    onClick={() => setShowAllAlerts((current) => !current)}
                    type="button"
                  >
                    {showAllAlerts ? 'ย่อรายการ' : `ดูทั้งหมด ${hiddenAlertCount} รายการ`}
                    <ChevronRight className={showAllAlerts ? 'rotate-up' : ''} size={15} />
                  </button>
                )}
              </div>
              <div className="alert-list">
                {alerts.length === 0 ? (
                  <div className="empty-alerts">
                    <ShieldCheck size={28} />
                    <strong>ยังไม่มีเหตุการณ์</strong>
                    <span>ระบบจะแสดงการแจ้งเตือนใหม่ที่นี่</span>
                  </div>
                ) : (
                  visibleAlerts.map((alert) => {
                    const isLiveAlert = alert.active && liveNodeIds.has(alert.node_id)

                    return (
                      <article className={`alert-row ${isLiveAlert ? '' : 'resolved'}`} key={alert._id}>
                        <div className="alert-main">
                          <span className={`alert-level state-${alert.level.toLowerCase()}`}>
                            <TriangleAlert size={17} />
                          </span>
                          <div>
                            <strong>
                              {stateLabels[alert.level]} · {alert.node_id}
                              {!alert.active && <span className="resolved-badge">สิ้นสุดแล้ว</span>}
                              {alert.active && !isLiveAlert && (
                                <span className="resolved-badge">ไม่อยู่ในรายการสด</span>
                              )}
                            </strong>
                            <span className="alert-summary">{formatAlertSummary(alert)}</span>
                            <small>{timeAgo(alert.started_at)}</small>
                          </div>
                        </div>
                        {adminMode && (
                          <button
                            aria-label={`ลบเหตุการณ์ ${alert.node_id}`}
                            className="alert-delete"
                            disabled={deletingAlertId === alert._id}
                            onClick={() => removeAlert(alert._id)}
                            title="ลบเหตุการณ์"
                            type="button"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </article>
                    )
                  })
                )}
              </div>
              </article>
            </div>
          </section>

          <section className="panel trend-panel" id="trends">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">SENSOR HISTORY</span>
                <h2>แนวโน้มข้อมูล · {selectedNode?.node_id ?? 'ยังไม่มีโหนด'}</h2>
              </div>
              <label>
                <span>จุดตรวจวัด</span>
                <select value={selectedNode?.node_id ?? ''} onChange={(event) => setSelectedNodeId(event.target.value)}>
                  {nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.node_id}</option>)}
                </select>
              </label>
            </div>
            <Suspense fallback={<div className="panel-loading">กำลังโหลดกราฟ…</div>}>
              <TrendChart
                readings={readings}
                selectedRange={chartRange}
                onRangeChange={setChartRange}
              />
            </Suspense>
          </section>

        </div>
        )}
      </main>

      {adminMode && manualLocation && (
        <div className="location-modal-backdrop" onMouseDown={closeManualLocation} role="presentation">
          <section
            aria-labelledby="manual-location-title"
            aria-modal="true"
            className="location-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <div>
                <span>MANUAL LOCATION</span>
                <h2 id="manual-location-title">กำหนดพิกัดเอง · {manualLocation.nodeId}</h2>
              </div>
              <button
                aria-label="ปิดหน้าต่างกรอกพิกัด"
                disabled={manualLocationSaving}
                onClick={closeManualLocation}
                title="ปิด"
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <form onSubmit={(event) => void submitManualLocation(event)}>
              <p className="location-form-note">
                เมื่อบันทึก ระบบจะใช้พิกัดนี้แทนและสั่งให้ Node หยุดค้นหา GPS ในรอบสื่อสารถัดไป
              </p>
              <div className="coordinate-fields">
                <label>
                  <span>ละติจูด</span>
                  <input
                    autoFocus
                    inputMode="decimal"
                    max="90"
                    min="-90"
                    onChange={(event) => setManualLocation((current) => current
                      ? { ...current, latitude: event.target.value }
                      : current)}
                    placeholder="เช่น 18.788300"
                    required
                    step="any"
                    type="number"
                    value={manualLocation.latitude}
                  />
                </label>
                <label>
                  <span>ลองจิจูด</span>
                  <input
                    inputMode="decimal"
                    max="180"
                    min="-180"
                    onChange={(event) => setManualLocation((current) => current
                      ? { ...current, longitude: event.target.value }
                      : current)}
                    placeholder="เช่น 98.985300"
                    required
                    step="any"
                    type="number"
                    value={manualLocation.longitude}
                  />
                </label>
              </div>
              {manualLocationHistory.length > 0 && (
                <section className="coordinate-history" aria-label="พิกัดที่ใช้ล่าสุด">
                  <div className="coordinate-history-title">
                    <History size={14} />
                    <span>พิกัดล่าสุด</span>
                    <small>เลือกใช้ได้ทันที</small>
                  </div>
                  <div className="coordinate-history-list">
                    {manualLocationHistory.map((entry) => (
                      <button
                        disabled={manualLocationSaving}
                        key={`${entry.latitude}:${entry.longitude}`}
                        onClick={() => selectManualLocationHistory(entry)}
                        type="button"
                      >
                        <MapPin size={14} />
                        <span>
                          <strong>{entry.latitude.toFixed(6)}, {entry.longitude.toFixed(6)}</strong>
                          <small>{entry.nodeId} · บันทึกเมื่อ {formatTime(entry.savedAt)}</small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {manualLocationError && <p className="location-form-error" role="alert">{manualLocationError}</p>}
              <footer>
                <button disabled={manualLocationSaving} onClick={closeManualLocation} type="button">ยกเลิก</button>
                <button className="save-location-button" disabled={manualLocationSaving} type="submit">
                  <MapPin size={15} />
                  {manualLocationSaving ? 'กำลังบันทึก' : 'บันทึกพิกัด'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
