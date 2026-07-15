import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getTimeRange, timeRangeOptions, type TimeRangeKey } from './timeRanges'
import type { Reading } from './types'

type MetricKey = 'smoke_raw' | 'air_temp' | 'humidity'

const metrics: Record<MetricKey, { label: string; unit: string; color: string }> = {
  smoke_raw: { label: 'ควัน', unit: ' raw', color: '#ee7548' },
  air_temp: { label: 'อุณหภูมิ', unit: '°C', color: '#f2a93b' },
  humidity: { label: 'ความชื้น', unit: '%', color: '#4da7a0' },
}

function formatChartTime(timestamp: string, range: TimeRangeKey) {
  const value = new Date(timestamp)
  const rangeHours = getTimeRange(range).hours

  if (rangeHours <= 24) {
    return new Intl.DateTimeFormat('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(value)
  }

  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

export function TrendChart({
  readings,
  selectedRange,
  onRangeChange,
}: {
  readings: Reading[]
  selectedRange: TimeRangeKey
  onRangeChange: (range: TimeRangeKey) => void
}) {
  const [metric, setMetric] = useState<MetricKey>('smoke_raw')
  const config = metrics[metric]
  const data = useMemo(() => {
    const selected = getTimeRange(selectedRange)
    const fromTime = Date.now() - selected.hours * 60 * 60 * 1000

    return readings
      .filter((reading) => new Date(reading.timestamp).getTime() >= fromTime)
      .sort((first, second) => new Date(first.timestamp).getTime() - new Date(second.timestamp).getTime())
      .map((reading) => ({
        ...reading,
        time: formatChartTime(reading.timestamp, selectedRange),
      }))
  }, [readings, selectedRange])

  return (
    <div className="trend">
      <div className="trend-controls">
        <div className="trend-tabs" aria-label="เลือกข้อมูลกราฟ">
          {(Object.entries(metrics) as [MetricKey, (typeof metrics)[MetricKey]][]).map(([key, item]) => (
            <button
              className={metric === key ? 'active' : ''}
              key={key}
              onClick={() => setMetric(key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="range-tabs" aria-label="เลือกช่วงเวลากราฟ">
          {timeRangeOptions.map((range) => (
            <button
              className={selectedRange === range.key ? 'active' : ''}
              key={range.key}
              onClick={() => onRangeChange(range.key)}
              type="button"
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-wrap">
        {data.length === 0 ? (
          <div className="chart-empty">
            <strong>ยังไม่มีข้อมูลในช่วงนี้</strong>
            <span>ลองเลือกช่วงเวลาที่ยาวขึ้น หรือรอข้อมูลรอบใหม่จากโหนด</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={config.color} stopOpacity={0.34} />
                  <stop offset="100%" stopColor={config.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#dddcd5" vertical={false} strokeDasharray="4 6" />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#7f817b', fontSize: 11 }}
                minTickGap={38}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#7f817b', fontSize: 11 }}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  border: '1px solid #d9d8d0',
                  borderRadius: 12,
                  boxShadow: '0 14px 34px rgba(26, 35, 30, .12)',
                }}
                formatter={(value) => [`${value ?? '—'}${config.unit}`, config.label]}
                labelFormatter={(label) => `เวลา ${label}`}
              />
              <Area
                type="monotone"
                dataKey={metric}
                stroke={config.color}
                strokeWidth={2.5}
                fill="url(#metricFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
