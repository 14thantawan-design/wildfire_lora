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
  risk_score?: number | null
  risk_source?: 'node' | 'legacy'
  risk_model_version?: number | null
  air_temp?: number | null
  humidity?: number | null
  smoke_raw?: number | null
  sensor_health?: string
  baseline_warmup_count?: number | null
  baseline_warmup_target?: number | null
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

export type BaselineRecalibrationPhase =
  | 'idle'
  | 'pending'
  | 'sent'
  | 'accepted'
  | 'calibrating'
  | 'completed'
  | 'rejected'

export interface BaselineRecalibrationCommand {
  command_id: string
  node_id: string
  command: 'baseline_recalibrate'
  status: 'pending' | 'sent' | 'acknowledged' | 'rejected'
  created_at: string
  sent_at?: string
  acknowledged_at?: string
  baseline_started_at?: string
  completed_at?: string
  result_reason?: string
  attempts?: number
}

export interface BaselineRecalibrationStatus {
  phase: BaselineRecalibrationPhase
  command: BaselineRecalibrationCommand | null
  node_id: string
  node_state: NodeState
  online: boolean
  baseline_warmup_count: number | null
  baseline_warmup_target: number | null
  duplicate?: boolean
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
  risk_score?: number | null
  risk_source?: 'node' | 'legacy'
  risk_model_version?: number | null
  air_temp?: number | null
  humidity?: number | null
  smoke_raw?: number | null
  smoke_baseline_delta?: number | null
  air_baseline_delta?: number | null
  humidity_baseline_delta?: number | null
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
    risk_score?: number | null
    risk_source?: 'node' | 'legacy'
    risk_model_version?: number | null
    node_state?: NodeState
    confidence?: number
    node_confidence?: number
    air_temp?: number | null
    humidity?: number | null
    smoke_raw?: number | null
    smoke_baseline_delta?: number | null
    air_baseline_delta?: number | null
    humidity_baseline_delta?: number | null
    sensor_health?: string
    rssi?: number
    snr?: number
  }
  message?: string
}
