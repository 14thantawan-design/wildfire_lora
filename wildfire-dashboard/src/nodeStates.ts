import type { NodeState } from './types'

export const stateLabels: Record<NodeState, string> = {
  NORMAL: 'ปกติ',
  WATCH: 'เฝ้าระวัง',
  WARNING: 'เตือนภัย',
  SENSOR_FAULT: 'เซนเซอร์ขัดข้อง',
  UNKNOWN: 'ไม่ทราบสถานะ',
}

export const stateSeverity: Record<NodeState, number> = {
  UNKNOWN: -1,
  NORMAL: 0,
  WATCH: 1,
  SENSOR_FAULT: 2,
  WARNING: 3,
}

export const stateColors: Record<NodeState, string> = {
  NORMAL: '#66c98a',
  WATCH: '#f5ad45',
  WARNING: '#e34b42',
  SENSOR_FAULT: '#a779e9',
  UNKNOWN: '#9ca3af',
}
