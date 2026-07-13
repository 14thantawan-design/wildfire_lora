import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  ChevronRight,
  Clock3,
  Droplets,
  Flame,
  History,
  LayoutDashboard,
  Map,
  Menu,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  Trash2,
  TriangleAlert,
  Wind,
  Wrench,
  X,
} from 'lucide-react'
import type { Alert, NodeState } from './types'
import { useDashboard } from './useDashboard'
import type { TimeRangeKey } from './timeRanges'
import './App.css'

const MapPanel = lazy(() =>
  import('./MapPanel').then((module) => ({ default: module.MapPanel })),
)
const TrendChart = lazy(() =>
  import('./TrendChart').then((module) => ({ default: module.TrendChart })),
)

type NavSection = 'overview' | 'map' | 'alerts' | 'trends'

const navSections: NavSection[] = ['overview', 'map', 'alerts', 'trends']

const stateLabels: Record<NodeState, string> = {
  CALIBRATING: 'กำลังปรับค่า',
  NORMAL: 'ปกติ',
  WATCH: 'เฝ้าระวัง',
  WARNING: 'เตือนภัย',
  CRITICAL: 'วิกฤต',
  SENSOR_FAULT: 'เซนเซอร์ขัดข้อง',
  UNKNOWN: 'ไม่ทราบสถานะ',
}

const severity: Record<NodeState, number> = {
  UNKNOWN: -1,
  NORMAL: 0,
  CALIBRATING: 1,
  WATCH: 2,
  WARNING: 3,
  CRITICAL: 4,
  SENSOR_FAULT: 5,
}

const alertReasonLabels: Record<string, string> = {
  baseline_calibrating: 'กำลังเรียนค่าเริ่มต้นของเซนเซอร์',
  smoke_sensor_low_stuck: 'ค่าควัน 0 ต่อเนื่อง',
  smoke_low_stable: 'ค่าควันต่ำคงที่',
  sensor_data_incomplete: 'ข้อมูลเซนเซอร์ประกอบไม่ครบ',
  sht31_missing: 'อุณหภูมิ/ความชื้นไม่ส่งค่า',
  sensor_fault: 'ตรวจพบปัญหาเซนเซอร์',
  smoke_weak: 'เริ่มพบสัญญาณควัน',
  smoke_strong: 'พบสัญญาณควันชัดเจน',
  smoke_critical: 'ควันสูงผิดปกติ',
  heat_weak: 'อุณหภูมิเริ่มสูงกว่าปกติ',
  heat_strong: 'อุณหภูมิสูงผิดปกติ',
  heat_critical: 'อุณหภูมิสูงระดับวิกฤต',
  temperature_fast_rise: 'อุณหภูมิเพิ่มเร็ว',
  humidity_dry: 'ความชื้นต่ำ',
  humidity_very_dry: 'อากาศแห้งมาก',
  humidity_critical_drop: 'ความชื้นลดลงแรง',
  humidity_fast_drop: 'ความชื้นลดเร็ว',
  weather_drift: 'อากาศเปลี่ยนตามธรรมชาติ',
  drying_condition: 'ความชื้นลดตามสภาพอากาศ',
}

function getHashSection(): NavSection {
  const hash = window.location.hash.replace('#', '') as NavSection
  return navSections.includes(hash) ? hash : 'overview'
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

function Value({
  value,
  suffix,
  fractionDigits,
}: {
  value?: number | null
  suffix?: string
  fractionDigits?: number
}) {
  const displayValue =
    value === undefined
      || value === null
      ? '—'
      : fractionDigits !== undefined
        ? value.toFixed(fractionDigits)
        : Number.isInteger(value)
          ? value
          : value.toFixed(1)

  return (
    <>
      {displayValue}
      {value !== undefined && value !== null && suffix && <small>{suffix}</small>}
    </>
  )
}

function formatAlertReason(reason: string) {
  return alertReasonLabels[reason] ?? reason.replaceAll('_', ' ')
}

function pickReason(reasons: string[], candidates: string[]) {
  return candidates.find((reason) => reasons.includes(reason))
}

function summarizeAlertReasons(reasons: string[] = []) {
  const smokeReason = pickReason(reasons, ['smoke_critical', 'smoke_strong', 'smoke_weak'])
  const heatReason = pickReason(reasons, [
    'heat_critical',
    'heat_strong',
    'temperature_fast_rise',
    'heat_weak',
  ])
  const humidityReason = pickReason(reasons, [
    'humidity_critical_drop',
    'humidity_fast_drop',
    'humidity_very_dry',
    'humidity_dry',
  ])
  const sensorReason = pickReason(reasons, ['sensor_data_incomplete', 'sht31_missing', 'sensor_fault'])
  const orderedReasons = [smokeReason, heatReason, humidityReason, sensorReason]
    .filter(Boolean) as string[]

  return orderedReasons.length
    ? orderedReasons.map(formatAlertReason).join(' + ')
    : reasons.slice(0, 3).map(formatAlertReason).join(', ')
}

function formatAlertMessage(alert: Alert) {
  const reasons = alert.reasons?.length
    ? summarizeAlertReasons(alert.reasons)
    : undefined

  if (alert.level === 'SENSOR_FAULT') {
    return reasons
      ? `เซนเซอร์ผิดปกติ: ${reasons}`
      : 'เซนเซอร์ผิดปกติ'
  }

  if (alert.level === 'CRITICAL') {
    return reasons
      ? `ระดับอันตราย: ${reasons}`
      : 'ระดับอันตราย'
  }

  if (alert.level === 'WARNING') {
    return reasons
      ? `ต้องตรวจสอบ: ${reasons}`
      : 'ต้องตรวจสอบ'
  }

  if (alert.level === 'WATCH') {
    return reasons
      ? `เฝ้าระวัง: ${reasons}`
      : 'เฝ้าระวัง'
  }

  return alert.message || 'ตรวจพบค่าสัญญาณผิดปกติ'
}

function formatMetric(value: number | null | undefined, suffix = '') {
  if (value === undefined || value === null) return '—'
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`
}

function buildAlertDiagnostics(alert: Alert) {
  const reasons = alert.reasons ?? []
  const reading = alert.last_reading
  const evidence: string[] = []
  const checks: string[] = []
  const hasSmokeIssue =
    reasons.includes('smoke_sensor_low_stuck') ||
    reasons.includes('smoke_low_stable') ||
    (typeof reading?.smoke_raw === 'number' && reading.smoke_raw <= 2)
  const hasHighSmokeEvidence =
    reasons.some((reason) => ['smoke_weak', 'smoke_strong', 'smoke_critical'].includes(reason)) ||
    (typeof reading?.smoke_raw === 'number' && reading.smoke_raw >= 250)
  const hasClimateIssue =
    reasons.includes('sht31_missing') ||
    (alert.level === 'SENSOR_FAULT' && (reading?.air_temp == null || reading?.humidity == null))
  const hasHeatEvidence =
    reasons.some((reason) =>
      ['heat_weak', 'heat_strong', 'heat_critical', 'temperature_fast_rise'].includes(reason),
    ) || reading?.evidence?.heat !== 'none'
  const hasHumidityEvidence =
    reasons.some((reason) =>
      ['humidity_dry', 'humidity_very_dry', 'humidity_critical_drop', 'humidity_fast_drop'].includes(reason),
    ) || reading?.evidence?.humidity !== 'none'

  if (reading?.sensor_health && reading.sensor_health !== 'OK') {
    evidence.push(`sensor_health = ${reading.sensor_health}`)
  }

  if (hasSmokeIssue) {
    evidence.push(`ค่าควันล่าสุด ${formatMetric(reading?.smoke_raw, ' raw')}`)
    evidence.push('ควันต่ำคงที่; ในห้องสะอาดอาจเป็นค่าปกติของวงจรนี้')
    checks.push('ทดสอบ Sharp ด้วยควัน/ฝุ่นอ่อน ๆ; ถ้ายัง 0 ค่อยเช็ก VCC, GND, OUT, ADC, LED drive')
  }

  if (hasHighSmokeEvidence) {
    evidence.push(`ค่าควันล่าสุด ${formatMetric(reading?.smoke_raw, ' raw')}`)
    checks.push('ถ้าเพิ่งทดสอบด้วยธูป/ควัน ให้ถือเป็นสัญญาณควันจริง ไม่ใช่เซนเซอร์เสีย')
  }

  if (hasHeatEvidence) {
    evidence.push(`อุณหภูมิล่าสุด ${formatMetric(reading?.air_temp, '°C')}`)
    evidence.push(`สูงกว่า baseline ${formatMetric(reading?.air_baseline_delta, '°C')}`)
  }

  if (hasHumidityEvidence) {
    evidence.push(`ความชื้นล่าสุด ${formatMetric(reading?.humidity, '%')}`)
    evidence.push(`ความชื้นเปลี่ยนจาก baseline ${formatMetric(reading?.humidity_baseline_delta, '%')}`)
  }

  if (hasClimateIssue) {
    evidence.push('อุณหภูมิ/ความชื้นไม่ส่งค่าล่าสุด')
    checks.push('SHT31: VCC, GND, SDA, SCL และ address I2C')
  }

  if (reading?.rssi !== undefined) {
    evidence.push(`LoRa RSSI ${reading.rssi} dBm`)
  }

  if (alert.level !== 'SENSOR_FAULT' && evidence.length === 0 && checks.length === 0) {
    return undefined
  }

  if (checks.length === 0) {
    checks.push('ดูสายเซนเซอร์และค่าที่ Node ส่งใน Serial Monitor')
  }

  return {
    title:
      hasSmokeIssue && hasClimateIssue
        ? 'ปัญหาที่สงสัย: อุณหภูมิ/ความชื้นไม่ส่งค่า'
        : hasHighSmokeEvidence && hasClimateIssue
          ? 'ตรวจพบควันสูง แต่ข้อมูลประกอบไม่ครบ'
        : hasHighSmokeEvidence && hasHeatEvidence
          ? 'หลักฐานร่วม: ควัน + อุณหภูมิ'
        : hasSmokeIssue
          ? 'หมายเหตุ: ค่าควันต่ำคงที่'
          : 'ปัญหาที่สงสัย: ชุดเซนเซอร์',
    evidence: [...new Set(evidence)],
    checks: [...new Set(checks)],
    timestamp: reading?.timestamp,
  }
}

function App() {
  const [selectedNodeId, setSelectedNodeId] = useState('NODE01')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [showAllAlerts, setShowAllAlerts] = useState(false)
  const [activeSection, setActiveSection] = useState<NavSection>(getHashSection)
  const [chartRange, setChartRange] = useState<TimeRangeKey>('1h')
  const [deletingAlertId, setDeletingAlertId] = useState<string>()
  const { nodes, alerts, readings, loading, demoMode, lastUpdated, refresh, deleteAlert } =
    useDashboard(selectedNodeId, chartRange)

  const selectedNode = nodes.find((node) => node.node_id === selectedNodeId) ?? nodes[0]
  const activeAlerts = alerts.filter((alert) => alert.active)
  const onlineNodes = nodes.filter((node) => node.online)
  const selectedSmoke =
    typeof selectedNode?.smoke_raw === 'number' ? Math.round(selectedNode.smoke_raw) : selectedNode?.smoke_raw
  const selectedNodeMeta = selectedNode
    ? `${selectedNode.node_id}${selectedNode.last_seq ? ` · รอบ ${selectedNode.last_seq}` : ''}`
    : 'ยังไม่มีโหนดที่เลือก'
  const highestState = useMemo(
    () =>
      nodes.reduce<NodeState>(
        (highest, node) => (severity[node.state] > severity[highest] ? node.state : highest),
        'NORMAL',
      ),
    [nodes],
  )
  const hasUnsafeNode = nodes.some((node) =>
    ['WARNING', 'CRITICAL', 'SENSOR_FAULT'].includes(node.state),
  )
  const hasActiveDangerAlert = activeAlerts.some((alert) =>
    ['WARNING', 'CRITICAL', 'SENSOR_FAULT'].includes(alert.level),
  )
  const isSafe = !hasUnsafeNode && !hasActiveDangerAlert
  const visibleAlerts = showAllAlerts ? alerts : alerts.slice(0, 5)
  const hiddenAlertCount = Math.max(0, alerts.length - visibleAlerts.length)

  const selectNode = (nodeId: string) => {
    setActiveSection('trends')
    setSelectedNodeId(nodeId)
    document.querySelector('#trends')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const scrollToAlerts = () => {
    setActiveSection('alerts')
    document.querySelector('#alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const closeMobileNav = () => {
    setMobileNavOpen(false)
  }

  const activateNav = (section: NavSection) => {
    setActiveSection(section)
    closeMobileNav()
  }

  const removeAlert = (alertId: string) => {
    setDeletingAlertId(alertId)
    void deleteAlert(alertId).finally(() => setDeletingAlertId(undefined))
  }

  const navClass = (section: NavSection) => (activeSection === section ? 'active' : undefined)

  useEffect(() => {
    const syncNavWithHash = () => setActiveSection(getHashSection())
    window.addEventListener('hashchange', syncNavWithHash)
    return () => window.removeEventListener('hashchange', syncNavWithHash)
  }, [])

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><Flame size={22} /></span>
          <div>
            <strong>FOREST<span>GUARD</span></strong>
            <small>LoRa early warning</small>
          </div>
          <button
            aria-label="ปิดเมนู"
            className="nav-close"
            onClick={() => setMobileNavOpen(false)}
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        <nav>
          <a
            aria-current={activeSection === 'overview' ? 'page' : undefined}
            className={navClass('overview')}
            href="#overview"
            onClick={() => activateNav('overview')}
          >
            <LayoutDashboard size={18} /> ภาพรวม
          </a>
          <a
            aria-current={activeSection === 'map' ? 'page' : undefined}
            className={navClass('map')}
            href="#map"
            onClick={() => activateNav('map')}
          >
            <Map size={18} /> แผนที่พื้นที่
          </a>
          <a
            aria-current={activeSection === 'alerts' ? 'page' : undefined}
            className={navClass('alerts')}
            href="#alerts"
            onClick={() => activateNav('alerts')}
          >
            <Bell size={18} /> การแจ้งเตือน <b>{activeAlerts.length}</b>
          </a>
          <a
            aria-current={activeSection === 'trends' ? 'page' : undefined}
            className={navClass('trends')}
            href="#trends"
            onClick={() => activateNav('trends')}
          >
            <History size={18} /> ข้อมูลย้อนหลัง
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="gateway-card">
            <span className="gateway-icon"><RadioTower size={18} /></span>
            <div>
              <strong>LoRa Gateway</strong>
              <small><i /> เชื่อมต่อระบบ</small>
            </div>
          </div>
          <div className="project-note">
            <span>โครงงานระบบต้นแบบ</span>
            <strong>ตรวจจับสัญญาณไฟป่าระยะเริ่มต้น</strong>
          </div>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          aria-label="ปิดเมนู"
          className="nav-backdrop"
          onClick={() => setMobileNavOpen(false)}
          type="button"
        />
      )}

      <main>
        <header className="topbar">
          <button
            aria-label="เปิดเมนู"
            className="menu-button"
            onClick={() => setMobileNavOpen(true)}
            type="button"
          >
            <Menu size={21} />
          </button>
          <div className="live-status">
            <i className={demoMode ? 'demo' : ''} />
            {demoMode ? 'โหมดข้อมูลตัวอย่าง' : 'เชื่อมต่อข้อมูลสด'}
          </div>
          <div className="topbar-actions">
            <span><Clock3 size={15} /> อัปเดต {formatTime(lastUpdated)}</span>
            <button
              aria-label="โหลดข้อมูลใหม่"
              className="icon-button"
              disabled={loading}
              onClick={() => void refresh()}
              title="โหลดข้อมูลใหม่"
              type="button"
            >
              <RefreshCw className={loading ? 'spin' : ''} size={17} />
            </button>
            <button
              aria-label="ดูการแจ้งเตือน"
              className="notification-button"
              onClick={scrollToAlerts}
              title="ดูการแจ้งเตือน"
              type="button"
            >
              <Bell size={18} />
              {activeAlerts.length > 0 && <b>{activeAlerts.length}</b>}
            </button>
          </div>
        </header>

        <div className="content" id="overview">
          <section className="page-heading">
            <div>
              <span className="eyebrow">ศูนย์เฝ้าระวังภาคสนาม</span>
              <h1>ภาพรวมพื้นที่ตรวจวัด</h1>
              <p>ติดตามสัญญาณควัน อุณหภูมิ และความชื้นจากเครือข่าย LoRa</p>
            </div>
            <div className="date-chip">
              <span>{new Intl.DateTimeFormat('th-TH', { weekday: 'long' }).format(new Date())}</span>
              <strong>{new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</strong>
            </div>
          </section>

          <section className={`safety-banner ${isSafe ? 'safe' : 'danger'}`}>
            <span className="safety-icon">
              {isSafe ? <ShieldCheck size={27} /> : <TriangleAlert size={27} />}
            </span>
            <div>
              <span>{isSafe ? 'สถานการณ์โดยรวม' : 'ต้องตรวจสอบทันที'}</span>
              <strong>
                {isSafe ? 'ยังไม่พบสัญญาณไฟป่าระดับอันตราย' : 'พบจุดตรวจวัดที่มีสถานะผิดปกติ'}
              </strong>
            </div>
            <span className="safety-detail">
              ระดับสูงสุด <b className={`text-${highestState.toLowerCase()}`}>{stateLabels[highestState]}</b>
            </span>
          </section>

          <section className="stat-grid">
            <article>
              <span className="stat-icon green"><RadioTower size={19} /></span>
              <div><span>โหนดออนไลน์</span><strong>{onlineNodes.length}<small> / {nodes.length} จุด</small></strong></div>
              <em>{nodes.length ? Math.round((onlineNodes.length / nodes.length) * 100) : 0}% พร้อมใช้งาน</em>
            </article>
            <article>
              <span className="stat-icon amber"><Wind size={19} /></span>
              <div><span>ควันล่าสุด</span><strong><Value value={selectedSmoke} suffix=" raw" /></strong></div>
              <em>{selectedNodeMeta}</em>
            </article>
            <article>
              <span className="stat-icon red"><Thermometer size={19} /></span>
              <div><span>อุณหภูมิล่าสุด</span><strong><Value value={selectedNode?.air_temp} suffix="°C" fractionDigits={1} /></strong></div>
              <em>{selectedNodeMeta}</em>
            </article>
            <article>
              <span className="stat-icon blue"><Droplets size={19} /></span>
              <div><span>ความชื้นล่าสุด</span><strong><Value value={selectedNode?.humidity} suffix="%" fractionDigits={1} /></strong></div>
              <em>{selectedNodeMeta}</em>
            </article>
          </section>

          <section className="dashboard-grid">
            <article className="panel map-panel" id="map">
              <div className="panel-head">
                <div><span className="panel-kicker">LIVE MAP</span><h2>แผนที่จุดตรวจวัด</h2></div>
                <span className="panel-meta"><i /> อัปเดตอัตโนมัติ</span>
              </div>
              <Suspense fallback={<div className="panel-loading">กำลังโหลดแผนที่…</div>}>
                <MapPanel nodes={nodes} selectedNodeId={selectedNode?.node_id ?? ''} onSelect={selectNode} />
              </Suspense>
            </article>

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
                    const diagnostics = buildAlertDiagnostics(alert)

                    return (
                      <article className="alert-row" key={alert._id}>
                        <button className="alert-main" onClick={() => selectNode(alert.node_id)} type="button">
                        <span className={`alert-level state-${alert.level.toLowerCase()}`}>
                          <TriangleAlert size={17} />
                        </span>
                        <div>
                          <strong>{stateLabels[alert.level]} · {alert.node_id}</strong>
                          <span>{formatAlertMessage(alert)}</span>
                          <small>{timeAgo(alert.started_at)}</small>
                        </div>
                          <ChevronRight size={16} />
                        </button>
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
                        {diagnostics && (
                          <div className="alert-diagnostics">
                            <div className="alert-diagnostics-head">
                              <span><Wrench size={13} /></span>
                              <strong>{diagnostics.title}</strong>
                              {diagnostics.timestamp && <small>{formatTime(diagnostics.timestamp)}</small>}
                            </div>
                            <div className="diagnostic-columns">
                              <div>
                                <span>หลักฐานที่ระบบเห็น</span>
                                {diagnostics.evidence.map((item) => <b key={item}>{item}</b>)}
                              </div>
                              <div>
                                <span>จุดที่ควรเช็ก</span>
                                {diagnostics.checks.map((item) => <b key={item}>{item}</b>)}
                              </div>
                            </div>
                          </div>
                        )}
                      </article>
                    )
                  })
                )}
              </div>
            </article>
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

          <footer id="system">
            <span>FORESTGUARD · WILDFIRE LORA MONITORING</span>
            <span>Prototype dashboard · ไม่ใช่ระบบยืนยันเหตุเพลิงไหม้ 100%</span>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default App
