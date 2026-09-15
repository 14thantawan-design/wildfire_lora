const mongoose = require('mongoose');

const readingSchema = new mongoose.Schema(
  {
    node_id: { type: String, required: true, index: true, trim: true },
    packet_id: { type: String },
    packet_hash: { type: String },
    packet_type: { type: String },
    session_id: { type: Number },
    report_interval_sec: { type: Number },
    seq: { type: Number, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    state: { type: String, index: true },
    confidence: { type: Number },
    node_state: { type: String, index: true },
    node_confidence: { type: Number },
    risk_score: { type: Number, min: 0, max: 100 },
    risk_reason_bits: { type: Number, min: 0, max: 255 },
    risk_reasons: { type: [String], default: undefined },
    risk_source: { type: String, enum: ['node'] },
    risk_model_version: { type: Number },
    // Legacy fields are read-only compatibility for existing stored records.
    server_state: {
      type: String,
      enum: ['CALIBRATING', 'NORMAL', 'WATCH', 'WARNING', 'CRITICAL', 'SENSOR_FAULT', 'OFFLINE'],
      index: true
    },
    server_risk_score: { type: Number },
    server_reasons: { type: [String], default: undefined },
    fire_danger_level: {
      type: String,
      enum: ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'],
      index: true
    },
    evidence: { type: mongoose.Schema.Types.Mixed },
    air_temp: { type: Number },
    humidity: { type: Number },
    particle_ug_m3: { type: Number },
    particle_baseline_delta_ug_m3: { type: Number },
    // Legacy ADC fields remain only so existing historical records can still be read.
    smoke_raw: { type: Number },
    smoke_baseline_delta: { type: Number },
    air_baseline_delta: { type: Number },
    humidity_baseline_delta: { type: Number },
    sensor_health: { type: String },
    baseline_warmup_count: { type: Number },
    baseline_warmup_target: { type: Number },
    rssi: { type: Number },
    snr: { type: Number },
    raw_packet: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  {
    collection: 'readings'
  }
);

readingSchema.index({ node_id: 1, timestamp: -1 });
readingSchema.index({ node_id: 1, seq: -1 });
readingSchema.index({ packet_id: 1 }, { unique: true, sparse: true });
readingSchema.index({ node_id: 1, packet_hash: 1, timestamp: -1 });

module.exports = mongoose.model('Reading', readingSchema);
