export const THAI_TIME_ZONE = 'Asia/Bangkok'

/** แสดง UTC Date ในช่อง datetime-local ด้วยเวลาไทยเสมอ */
export function toThaiDateTimeInput(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: THAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value: part }) => [type, part]))

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

/** เวลาไทยในช่องแก้ไขกลับเป็น UTC ก่อนส่ง API (ไทยใช้ UTC+07:00) */
export function thaiDateTimeInputToIso(value: string) {
  return new Date(`${value}+07:00`).toISOString()
}
