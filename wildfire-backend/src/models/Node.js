const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema(
  {
    node_id: { type: String, required: true, unique: true, index: true, trim: true },
    state: {
      type: String,
      enum: ['UNKNOWN', 'NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT'],
      default: 'UNKNOWN',
      index: true
    },
    risk_model_version: { type: Number, enum: [8] },
    air_temp: { type: Number },
    humidity: { type: Number },
    particle_ug_m3: { type: Number },
    sensor_health: { type: String },
    lat: { type: Number },
    lng: { type: Number },
    gps_fixed: { type: Boolean, default: false },
    gps_error: { type: String },
    location_source: { type: String, enum: ['gps', 'manual'] },
    location_updated_at: { type: Date },
    last_seen: { type: Date },
    session_id: { type: Number },
    last_seq: { type: Number },
    report_interval_sec: { type: Number },
    rssi: { type: Number },
    snr: { type: Number }
  },
  {
    collection: 'nodes',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

module.exports = mongoose.model('Node', nodeSchema);
