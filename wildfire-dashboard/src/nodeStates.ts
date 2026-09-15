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

const reasonLabels: Record<string, string> = {
  node_reported: 'ใช้สถานะที่โหนดประเมินส่งมา',
  temperature_above_45: 'อุณหภูมิสูงกว่า 45°C',
  particle_above_150: 'อนุภาคโดยประมาณสูงกว่า 150 µg/m³',
  hot_dry_30_30: 'อุณหภูมิอย่างน้อย 30°C และความชื้นไม่เกิน 30%RH',
  temperature_above_35: 'อุณหภูมิสูงกว่า 35°C',
  particle_above_50: 'อนุภาคโดยประมาณสูงกว่า 50 µg/m³',
  humidity_below_50: 'ความชื้นต่ำกว่า 50%RH',
  recovery_confirmation_pending: 'กำลังยืนยันค่าปกติก่อนลดระดับ',
  smoke_sensor_low_stuck: 'ค่าอนุภาค 0 ต่อเนื่อง',
  smoke_low_stable: 'ค่าอนุภาคต่ำคงที่',
  sensor_data_incomplete: 'ข้อมูลเซนเซอร์ประกอบไม่ครบ',
  sht31_missing: 'อุณหภูมิ/ความชื้นไม่ส่งค่า',
  sensor_fault: 'ตรวจพบปัญหาเซนเซอร์',
  smoke_weak: 'เริ่มพบอนุภาคควัน',
  smoke_strong: 'พบอนุภาคควันชัดเจน',
  smoke_critical: 'อนุภาคควันสูงผิดปกติ',
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
