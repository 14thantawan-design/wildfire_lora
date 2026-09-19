export type NodeState =
  | 'NORMAL'
  | 'WATCH'
  | 'WARNING'
  | 'SENSOR_FAULT'
  | 'UNKNOWN'

export interface NodeStatus {
  _id?: string
  node_id: string
  state: NodeState
  air_temp?: number | null
  humidity?: number | null
  particle_adc?: number | null
  sensor_health?: string
  lat?: number
  lng?: number
  gps_fixed?: boolean
  gps_error?: string
  location_source?: 'gps' | 'manual'
  location_updated_at?: string
  last_seen?: string
  last_seq?: number
  report_interval_sec?: number
  rssi?: number
  snr?: number
  online: boolean
}

export interface GpsReacquireCommand {
  command_id: string
  node_id: string
  command: 'gps_reacquire'
  created_at: string
  duplicate: boolean
}

export interface ManualLocationInput {
  lat: number
  lng: number
}

export interface Reading {
  _id?: string
  node_id: string
  seq?: number
  timestamp: string
  state: NodeState
  air_temp?: number | null
  humidity?: number | null
  particle_adc?: number | null
  sensor_health?: string
  rssi?: number
  snr?: number
}

export interface GatewayStatus {
  connected: boolean
  last_packet_at?: string
  transport?: 'http'
  timeout_ms: number
}

export interface ApiHealth {
  ok: boolean
  mongo_state: number
  gateway: GatewayStatus
}

export interface Alert {
  _id: string
  node_id: string
  level: Exclude<NodeState, 'NORMAL' | 'UNKNOWN'>
  started_at: string
  ended_at?: string
  active: boolean
  max_state?: NodeState
  last_reading?: {
    reading_id?: string
    seq?: number
    timestamp?: string
    state?: NodeState
    air_temp?: number | null
    humidity?: number | null
    particle_adc?: number | null
    sensor_health?: string
    rssi?: number
    snr?: number
  }
  message?: string
}
