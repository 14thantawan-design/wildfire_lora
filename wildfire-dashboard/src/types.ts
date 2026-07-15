export type NodeState =
  | 'CALIBRATING'
  | 'NORMAL'
  | 'WATCH'
  | 'WARNING'
  | 'CRITICAL'
  | 'SENSOR_FAULT'
  | 'UNKNOWN'

export interface NodeStatus {
  _id?: string
  node_id: string
  state: NodeState
  confidence?: number
  node_state?: NodeState
  node_confidence?: number
  server_state?: NodeState | 'OFFLINE'
  server_risk_score?: number
  server_reasons?: string[]
  fire_danger_level?: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH'
  air_temp?: number | null
  humidity?: number | null
  smoke_raw?: number | null
  sensor_health?: string
  lat?: number
  lng?: number
  gps_satellites?: number
  gps_hdop?: number
  gps_fixed?: boolean
  gps_error?: string
  location_source?: 'gps' | 'manual'
  location_updated_at?: string
  last_seen?: string
  last_seq?: number
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
  confidence?: number
  node_state?: NodeState
  node_confidence?: number
  server_state?: NodeState
  server_risk_score?: number
  server_reasons?: string[]
  fire_danger_level?: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH'
  air_temp?: number | null
  humidity?: number | null
  smoke_raw?: number | null
  smoke_delta?: number | null
  smoke_baseline_delta?: number | null
  air_baseline_delta?: number | null
  humidity_baseline_delta?: number | null
  sensor_health?: string
  rssi?: number
  snr?: number
}

export interface Alert {
  _id: string
  node_id: string
  level: Exclude<NodeState, 'CALIBRATING' | 'NORMAL' | 'UNKNOWN'>
  started_at: string
  ended_at?: string
  active: boolean
  max_confidence?: number
  max_risk_score?: number
  max_state?: NodeState
  reasons?: string[]
  last_reading?: {
    reading_id?: string
    seq?: number
    timestamp?: string
    state?: NodeState
    server_state?: NodeState
    server_risk_score?: number
    server_reasons?: string[]
    fire_danger_level?: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH'
    evidence?: Record<string, string>
    node_state?: NodeState
    confidence?: number
    node_confidence?: number
    air_temp?: number | null
    humidity?: number | null
    smoke_raw?: number | null
    smoke_delta?: number | null
    smoke_baseline_delta?: number | null
    air_baseline_delta?: number | null
    humidity_baseline_delta?: number | null
    sensor_health?: string
    rssi?: number
    snr?: number
  }
  message?: string
}
