/**
 * ฟังก์ชันช่วยแปลงข้อมูลดิบให้เป็นข้อความที่หน้า Dashboard นำไปแสดงผล
 * ไฟล์นี้ไม่มีการเรียก API และไม่มี React state จึงอ่านและทดสอบได้ง่าย
 */
import type { Alert, NodeState, NodeStatus } from './types'
import { stateLabels } from './nodeStates'

const ADMIN_HOSTNAME = (import.meta.env.VITE_ADMIN_HOSTNAME || 'admin.nattaphat.me').toLowerCase()

export type SafetyBanner = {
  tone: 'safe' | 'watch' | 'danger' | 'unknown'
  heading: string
  message: string
}

export type GpsStatus = {
  tone: 'muted' | 'searching' | 'error' | 'manual' | 'ready'
  text: string
}

/** ตรวจจาก hostname ว่าหน้าเว็บควรแสดงเครื่องมือของผู้ดูแลหรือไม่ */
export function isAdminHostname(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized === ADMIN_HOSTNAME || normalized === 'localhost' || normalized === '127.0.0.1'
}

/** แสดงเวลาตามรูปแบบภาษาไทย */
export function formatTime(value?: string | Date) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

/** แปลงวันเวลาเป็นข้อความ เช่น "2 นาทีที่แล้ว" */
export function timeAgo(value?: string) {
  if (!value) return 'ยังไม่มีข้อมูล'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds} วินาทีที่แล้ว`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  return `${Math.floor(minutes / 60)} ชั่วโมงที่แล้ว`
}

/** ตรวจว่าละติจูดและลองจิจูดอยู่ในช่วงที่ใช้แสดงบนแผนที่ได้ */
export function hasValidCoordinates(latitude?: number, longitude?: number) {
  return typeof latitude === 'number' && Number.isFinite(latitude) &&
    typeof longitude === 'number' && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180 &&
    (Math.abs(latitude) >= 0.000001 || Math.abs(longitude) >= 0.000001)
}

/** เลือกข้อความและสีของแถบสรุปความปลอดภัยจากสถานะสูงสุดของโหนด */
export function safetyBannerFor(canAssess: boolean, state: NodeState): SafetyBanner {
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

/** รวมค่าที่ตรวจวัดล่าสุดเป็นข้อความสั้นสำหรับรายการแจ้งเตือน */
export function formatAlertSummary(alert: Alert) {
  const reading = alert.last_reading
  if (!reading) return `โหนดรายงานสถานะ ${stateLabels[alert.level]}`

  const values = [
    typeof reading.air_temp === 'number' ? `${reading.air_temp.toFixed(1)}°C` : undefined,
    typeof reading.humidity === 'number' ? `${reading.humidity.toFixed(1)}%RH` : undefined,
    typeof reading.particle_adc === 'number' ? `${reading.particle_adc.toFixed(0)} ADC` : undefined,
  ].filter(Boolean)

  return values.length > 0
    ? `${stateLabels[alert.level]} · ${values.join(' · ')}`
    : `โหนดรายงานสถานะ ${stateLabels[alert.level]}`
}

/** สร้างข้อความสถานะ GPS ของโหนดที่เลือก */
export function gpsStatusFor(
  node: NodeStatus | undefined,
  requesting: boolean,
  requestError?: { nodeId: string; message: string },
): GpsStatus {
  if (!node) return { tone: 'muted', text: 'ยังไม่มีจุดตรวจ' }
  if (requesting) return { tone: 'searching', text: `${node.node_id} · กำลังส่งคำสั่ง` }
  if (requestError?.nodeId === node.node_id) return { tone: 'error', text: requestError.message }
  if (node.location_source === 'manual') {
    if (node.gps_error === 'gps_reacquiring') {
      return { tone: 'searching', text: `${node.node_id} · ใช้พิกัดที่กรอก · กำลังหา GPS` }
    }
    if (node.gps_error === 'gps_failed') {
      return { tone: 'manual', text: `${node.node_id} · พิกัดกำหนดเอง · GPS ไม่พร้อม` }
    }
    return { tone: 'manual', text: `${node.node_id} · พิกัดกำหนดเอง` }
  }
  if (node.gps_error === 'gps_reacquiring') {
    return { tone: 'searching', text: `${node.node_id} · รอพิกัดใหม่` }
  }
  if (node.gps_error === 'gps_failed') {
    return { tone: 'error', text: `${node.node_id} · ยังหา GPS ไม่พบ` }
  }
  if (node.gps_fixed) return { tone: 'ready', text: `${node.node_id} · GPS พร้อม` }
  return { tone: 'muted', text: `${node.node_id} · ยังไม่มีพิกัด GPS` }
}
