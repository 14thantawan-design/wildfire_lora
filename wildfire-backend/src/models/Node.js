const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema(
  {
    node_id: { type: String, required: true, unique: true, index: true, trim: true },
    state: { type: String, default: 'UNKNOWN', index: true },
    confidence: { type: Number, default: 0 },
    air_temp: { type: Number },
    humidity: { type: Number },
    smoke_raw: { type: Number },
    sensor_health: { type: String },
    lat: { type: Number },
    lng: { type: Number },
    gps_satellites: { type: Number },
    gps_hdop: { type: Number },
    gps_fixed: { type: Boolean, default: false },
    gps_error: { type: String },
    last_seen: { type: Date },
    last_seq: { type: Number },
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
