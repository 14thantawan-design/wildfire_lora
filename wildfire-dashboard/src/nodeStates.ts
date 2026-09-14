import type { NodeState } from './types'

export const stateLabels: Record<NodeState, string> = {
  CALIBRATING: 'กำลังปรับค่า',
  NORMAL: 'ปกติ',
  WATCH: 'เฝ้าระวัง',
  WARNING: 'เตือนภัย',
  CRITICAL: 'วิกฤต',
  SENSOR_FAULT: 'เซนเซอร์ขัดข้อง',
  UNKNOWN: 'ไม่ทราบสถานะ',
}

export const stateSeverity: Record<NodeState, number> = {
  UNKNOWN: -1,
  NORMAL: 0,
  CALIBRATING: 1,
  WATCH: 2,
  SENSOR_FAULT: 3,
  WARNING: 4,
  CRITICAL: 5,
}

export const stateColors: Record<NodeState, string> = {
  NORMAL: '#66c98a',
  WATCH: '#f5ad45',
  WARNING: '#f57845',
  CRITICAL: '#e34b42',
  SENSOR_FAULT: '#a779e9',
  CALIBRATING: '#6fb3d9',
  UNKNOWN: '#9ca3af',
}

const reasonLabels: Record<string, string> = {
  node_reported: 'ใช้คะแนนและสถานะที่โหนดประเมินส่งมา',
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

export function formatReason(reason: string) {
  return reasonLabels[reason] ?? reason.replaceAll('_', ' ')
}
