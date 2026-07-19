const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema(
  {
    node_id: { type: String, required: true, unique: true, index: true, trim: true },
    state: { type: String, default: 'UNKNOWN', index: true },
    confidence: { type: Number, default: 0 },
    node_state: { type: String, default: 'UNKNOWN', index: true },
    node_confidence: { type: Number, default: 0 },
    server_state: {
      type: String,
      default: 'NORMAL',
      enum: ['CALIBRATING', 'NORMAL', 'WATCH', 'WARNING', 'CRITICAL', 'SENSOR_FAULT', 'OFFLINE'],
      index: true
    },
    server_risk_score: { type: Number, default: 0 },
    server_reasons: { type: [String], default: [] },
    fire_danger_level: {
      type: String,
      default: 'LOW',
      enum: ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'],
      index: true
    },
    evidence: { type: mongoose.Schema.Types.Mixed },
    air_temp: { type: Number },
    humidity: { type: Number },
    smoke_raw: { type: Number },
    battery_v: { type: Number },
    battery_percent: { type: Number, min: 0, max: 100 },
    sensor_health: { type: String },
    lat: { type: Number },
    lng: { type: Number },
    gps_satellites: { type: Number },
    gps_hdop: { type: Number },
    gps_fixed: { type: Boolean, default: false },
    gps_error: { type: String },
    location_source: { type: String, enum: ['gps', 'manual'] },
    location_updated_at: { type: Date },
    last_seen: { type: Date },
    last_seq: { type: Number },
    report_interval_sec: { type: Number },
    rssi: { type: Number },
    snr: { type: Number },
    online: { type: Boolean, default: false }
  },
  {
    collection: 'nodes',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

module.exports = mongoose.model('Node', nodeSchema);
