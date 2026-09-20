/** ส่วนสรุปสถานการณ์และค่าล่าสุดของโหนดที่ผู้ใช้เลือก */
import { Droplets, RadioTower, ShieldCheck, Thermometer, TriangleAlert, Wind } from 'lucide-react'
import type { NodeState, NodeStatus } from '../types'
import type { SafetyBanner } from '../dashboardView'
import { stateLabels } from '../nodeStates'

type MetricValueProps = {
  value?: number | null
  suffix?: string
  fractionDigits?: number
}

type DashboardSummaryProps = {
  onlineNodeCount: number
  selectedLiveNode?: NodeStatus
  metricMeta: string
  safetyBanner: SafetyBanner
  canAssessSafety: boolean
  highestState: NodeState
}

/** จัดรูปแบบตัวเลขของการ์ดค่าเซนเซอร์และแสดงขีดเมื่อยังไม่มีข้อมูล */
function MetricValue({ value, suffix, fractionDigits }: MetricValueProps) {
  const hasValue = value !== undefined && value !== null
  const digits = fractionDigits ?? (hasValue && Number.isInteger(value) ? 0 : 1)
  const displayValue = hasValue
    ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—'

  return (
    <>
      <span className="metric-number">{displayValue}</span>
      {hasValue && suffix && <small>{suffix.trim()}</small>}
    </>
  )
}

/** แสดงหัวข้อหน้า แถบความปลอดภัย และการ์ดค่าล่าสุดทั้งสี่ใบ */
export function DashboardSummary({
  onlineNodeCount,
  selectedLiveNode,
  metricMeta,
  safetyBanner,
  canAssessSafety,
  highestState,
}: DashboardSummaryProps) {
  const now = new Date()
  return (
    <>
      <section className="page-heading">
        <div>
          <span className="eyebrow">ศูนย์เฝ้าระวังภาคสนาม</span>
          <h1>ภาพรวมพื้นที่ตรวจวัด</h1>
          <p>ติดตามอุณหภูมิ ความชื้น และอนุภาคควันจากเครือข่าย LoRa</p>
        </div>
        <div className="date-chip">
          <span>{new Intl.DateTimeFormat('th-TH', { weekday: 'long' }).format(now)}</span>
          <strong>{new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</strong>
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
            <>ประเมินจาก {onlineNodeCount} จุด · ระดับสูงสุด <b className={`text-${highestState.toLowerCase()}`}>{stateLabels[highestState]}</b></>
          )}
        </span>
      </section>

      <section className="stat-grid">
        <article>
          <span className="stat-icon green"><RadioTower size={19} /></span>
          <div><span>โหนดออนไลน์</span><strong>{onlineNodeCount}<small> จุด</small></strong></div>
          <em>แสดงเฉพาะโหนดที่ส่งข้อมูลอยู่</em>
        </article>
        <article>
          <span className="stat-icon red"><Thermometer size={19} /></span>
          <div><span>อุณหภูมิล่าสุด</span><strong><MetricValue value={selectedLiveNode?.air_temp} suffix="°C" fractionDigits={1} /></strong></div>
          <em>{metricMeta}</em>
        </article>
        <article>
          <span className="stat-icon blue"><Droplets size={19} /></span>
          <div><span>ความชื้นล่าสุด</span><strong><MetricValue value={selectedLiveNode?.humidity} suffix="%" fractionDigits={1} /></strong></div>
          <em>{metricMeta}</em>
        </article>
        <article>
          <span className="stat-icon amber"><Wind size={19} /></span>
          <div><span>ค่าควันล่าสุด</span><strong><MetricValue value={selectedLiveNode?.particle_adc} suffix=" ADC" fractionDigits={0} /></strong></div>
          <em>{metricMeta}</em>
        </article>
      </section>
    </>
  )
}
