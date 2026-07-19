export type BatteryTone = 'normal' | 'low' | 'critical' | 'unknown'

const batteryCurve: ReadonlyArray<readonly [number, number]> = [
  [3.3, 0],
  [3.4, 5],
  [3.5, 10],
  [3.6, 20],
  [3.7, 40],
  [3.8, 60],
  [3.9, 70],
  [4.0, 80],
  [4.1, 90],
  [4.2, 100],
]

function estimatePercent(voltage: number) {
  const first = batteryCurve[0]
  const last = batteryCurve[batteryCurve.length - 1]
  if (voltage <= first[0]) return first[1]
  if (voltage >= last[0]) return last[1]

  for (let index = 1; index < batteryCurve.length; index += 1) {
    const upper = batteryCurve[index]
    if (voltage > upper[0]) continue

    const lower = batteryCurve[index - 1]
    const position = (voltage - lower[0]) / (upper[0] - lower[0])
    return Math.round(lower[1] + position * (upper[1] - lower[1]))
  }

  return last[1]
}

export function getBatteryDisplay(
  voltage?: number | null,
  percent?: number | null,
) {
  const available = typeof voltage === 'number'
    && Number.isFinite(voltage)
    && voltage >= 2.5
    && voltage <= 5

  if (!available) {
    return {
      available: false,
      tone: 'unknown' as BatteryTone,
      voltageText: '—',
      percent: undefined,
      percentText: 'ยังไม่มีข้อมูลแบต',
      statusText: 'ยังไม่มีข้อมูลแบต',
    }
  }

  const normalizedPercent = typeof percent === 'number' && Number.isFinite(percent)
    ? Math.max(0, Math.min(100, Math.round(percent)))
    : estimatePercent(voltage)
  const tone: BatteryTone = voltage <= 3.4
    ? 'critical'
    : voltage <= 3.5
      ? 'low'
      : 'normal'

  return {
    available: true,
    tone,
    voltageText: `${voltage.toFixed(2)}V`,
    percent: normalizedPercent,
    percentText: `แบตประมาณ ${normalizedPercent}%`,
    statusText: tone === 'critical' ? 'วิกฤต' : tone === 'low' ? 'แบตต่ำ' : 'ปกติ',
  }
}
