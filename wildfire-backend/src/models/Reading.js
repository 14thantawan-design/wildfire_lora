const mongoose = require('mongoose');

const readingSchema = new mongoose.Schema(
  {
    node_id: { type: String, required: true, index: true, trim: true },
    seq: { type: Number, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    state: { type: String, index: true },
    confidence: { type: Number },
    node_state: { type: String, index: true },
    node_confidence: { type: Number },
    server_state: {
      type: String,
      enum: ['CALIBRATING', 'NORMAL', 'WATCH', 'WARNING', 'CRITICAL', 'SENSOR_FAULT', 'OFFLINE'],
      index: true
    },
    server_risk_score: { type: Number },
    server_reasons: { type: [String], default: [] },
    fire_danger_level: {
      type: String,
      enum: ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'],
      index: true
    },
    evidence: { type: mongoose.Schema.Types.Mixed },
    air_temp: { type: Number },
    humidity: { type: Number },
    smoke_raw: { type: Number },
    smoke_delta: { type: Number },
    smoke_baseline_delta: { type: Number },
    air_baseline_delta: { type: Number },
    humidity_baseline_delta: { type: Number },
    sensor_health: { type: String },
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

module.exports = mongoose.model('Reading', readingSchema);
