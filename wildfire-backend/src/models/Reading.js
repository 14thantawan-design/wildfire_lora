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
    state: {
      type: String,
      enum: ['NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT'],
      index: true
    },
    risk_reason_bits: { type: Number, min: 0, max: 255 },
    risk_reasons: { type: [String], default: undefined },
    risk_model_version: { type: Number, enum: [7] },
    air_temp: { type: Number },
    humidity: { type: Number },
    particle_ug_m3: { type: Number },
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
readingSchema.index({ packet_id: 1 }, { unique: true, sparse: true });
readingSchema.index({ node_id: 1, packet_hash: 1, timestamp: -1 });

module.exports = mongoose.model('Reading', readingSchema);
