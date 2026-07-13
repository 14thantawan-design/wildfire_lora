import type { Alert, NodeStatus, Reading } from './types'

const now = Date.now()

export const mockNodes: NodeStatus[] = [
  {
    node_id: 'NODE01',
    state: 'NORMAL',
    confidence: 8,
    air_temp: 31.8,
    humidity: 58.2,
    smoke_raw: 116,
    sensor_health: 'OK',
    lat: 18.8073,
    lng: 98.9446,
    gps_satellites: 8,
    gps_fixed: true,
    last_seen: new Date(now - 12_000).toISOString(),
    last_seq: 1842,
    rssi: -74,
    snr: 8.4,
    online: true,
  },
  {
    node_id: 'NODE02',
    state: 'WATCH',
    confidence: 46,
    air_temp: 35.6,
    humidity: 43.1,
    smoke_raw: 284,
    sensor_health: 'OK',
    lat: 18.8265,
    lng: 98.9712,
    gps_satellites: 7,
    gps_fixed: true,
    last_seen: new Date(now - 28_000).toISOString(),
    last_seq: 1795,
    rssi: -91,
    snr: 5.1,
    online: true,
  },
]

function buildReadings(node: NodeStatus): Reading[] {
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const ages = [
    ...Array.from({ length: 25 }, (_, index) => index * 5 * minute),
    ...Array.from({ length: 20 }, (_, index) => (3 + index * 0.35) * hour),
    ...Array.from({ length: 20 }, (_, index) => (12 + index * 2) * hour),
    ...Array.from({ length: 24 }, (_, index) => (3 + index * 0.45) * day),
    ...Array.from({ length: 26 }, (_, index) => (16 + index * 2.1) * day),
    ...Array.from({ length: 36 }, (_, index) => (75 + index * 8) * day),
  ]
    .filter((age) => age <= 365 * day)
    .sort((first, second) => second - first)

  return ages.map((age, index) => {
    const progress = index / Math.max(1, ages.length - 1)
    const rising = node.node_id === 'NODE02' ? progress * 72 : progress * 10
    const wave = Math.sin(index / 2.5)

    return {
      node_id: node.node_id,
      seq: (node.last_seq ?? 1000) - ages.length + index,
      timestamp: new Date(now - age).toISOString(),
      state: progress > 0.93 ? node.state : 'NORMAL',
      confidence: Math.max(4, (node.confidence ?? 0) * progress),
      air_temp: Number(((node.air_temp ?? 30) - 3.2 + progress * 3.2 + wave * 0.45).toFixed(1)),
      humidity: Number(((node.humidity ?? 55) + 7 - progress * 7 - wave).toFixed(1)),
      smoke_raw: Math.max(0, Math.round((node.smoke_raw ?? 100) - rising + progress * rising + wave * 7)),
      smoke_baseline_delta: Math.round(rising),
      air_baseline_delta: Number((progress * 4).toFixed(1)),
      humidity_baseline_delta: Number((-progress * 6).toFixed(1)),
      sensor_health: 'OK',
      rssi: node.rssi,
      snr: node.snr,
    }
  })
}

export const mockReadings = Object.fromEntries(
  mockNodes.map((node) => [node.node_id, buildReadings(node)]),
) as Record<string, Reading[]>

export const mockAlerts: Alert[] = [
  {
    _id: 'demo-alert-1',
    node_id: 'NODE02',
    level: 'WATCH',
    started_at: new Date(now - 21 * 60_000).toISOString(),
    active: true,
    max_confidence: 46,
    message: 'ตรวจพบค่าควันเพิ่มจากค่าฐาน',
  },
]
