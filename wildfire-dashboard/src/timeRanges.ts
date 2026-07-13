export type TimeRangeKey = '1h' | '8h' | '1d' | '1w' | '1m' | '1y'

export const timeRangeOptions: Array<{
  key: TimeRangeKey
  label: string
  hours: number
  apiLimit: number
}> = [
  { key: '1h', label: '1 ชม.', hours: 1, apiLimit: 720 },
  { key: '8h', label: '8 ชม.', hours: 8, apiLimit: 1000 },
  { key: '1d', label: '1 วัน', hours: 24, apiLimit: 1500 },
  { key: '1w', label: '1 สัปดาห์', hours: 24 * 7, apiLimit: 2500 },
  { key: '1m', label: '1 เดือน', hours: 24 * 30, apiLimit: 3500 },
  { key: '1y', label: '1 ปี', hours: 24 * 365, apiLimit: 5000 },
]

export function getTimeRange(key: TimeRangeKey) {
  return timeRangeOptions.find((option) => option.key === key) ?? timeRangeOptions[0]
}
