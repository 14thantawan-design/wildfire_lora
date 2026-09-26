/**
 * ชนิดข้อมูล ฟังก์ชันเรียก API และตัวช่วยแปลงข้อมูลของหน้าจัดการ Reading
 * แยกออกจาก Component เพื่อไม่ให้ไฟล์หน้าจอปนกับรายละเอียดการแปลงข้อมูล
 */
import type { Reading } from '../types'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export type AdminReading = Omit<Reading, '_id'> & { _id: string }

export type AdminReadingsResponse = {
  items: AdminReading[]
  total: number
  page: number
  limit: number
  node_ids: string[]
}

export type EditDraft = {
  timestamp: string
  air_temp: string
  humidity: string
  particle_adc: string
  rssi: string
  snr: string
}

/** เรียก Admin API และเปลี่ยน HTTP error ให้เป็นข้อความที่หน้าเว็บแสดงได้ */
export async function adminJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) {
    if (response.status === 403) throw new Error('บัญชีหรือโดเมนนี้ไม่มีสิทธิ์จัดการข้อมูล')
    throw new Error(body.error || `API ${response.status}`)
  }
  return body as T
}

/** แสดงเวลาของ Reading ในรูปแบบภาษาไทย */
export function formatReadingDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

/** แปลงวันเวลาเป็นค่าที่ input ชนิด datetime-local ใช้ได้ */
function toDateTimeInput(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 19)
}

/** สร้างค่าตั้งต้นของแบบฟอร์มแก้ไขจาก Reading ที่เลือก */
export function toEditDraft(reading: AdminReading): EditDraft {
  const asInput = (value: number | null | undefined) => value == null ? '' : String(value)
  return {
    timestamp: toDateTimeInput(reading.timestamp),
    air_temp: asInput(reading.air_temp),
    humidity: asInput(reading.humidity),
    particle_adc: asInput(reading.particle_adc),
    rssi: asInput(reading.rssi),
    snr: asInput(reading.snr),
  }
}

/** จัดรูปแบบตัวเลขสำหรับช่องในตาราง */
export function displayNumber(value: number | null | undefined, suffix = '', digits = 1) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits })}${suffix}`
}

/** แปลงช่องกรอกว่างเป็น null และช่องที่มีค่าเป็นตัวเลข */
export function nullableNumber(value: string) {
  return value.trim() === '' ? null : Number(value)
}
