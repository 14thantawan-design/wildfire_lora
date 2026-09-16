const mongoose = require('mongoose');

const readingSchema = new mongoose.Schema(
  {
    node_id: { type: String, required: true, index: true, trim: true },
    session_id: { type: Number },
    report_interval_sec: { type: Number },
    seq: { type: Number, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    state: {
      type: String,
      enum: ['NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT'],
      index: true
    },
    air_temp: { type: Number },
    humidity: { type: Number },
    particle_ug_m3: { type: Number },
    sensor_health: { type: String },
    rssi: { type: Number },
    snr: { type: Number }
  },
  {
    collection: 'readings',
    versionKey: false
  }
);

readingSchema.index({ node_id: 1, timestamp: -1 });
readingSchema.index({ node_id: 1, seq: -1 });
readingSchema.index({ node_id: 1, session_id: 1, seq: 1 }, { unique: true });

module.exports = mongoose.model('Reading', readingSchema);
