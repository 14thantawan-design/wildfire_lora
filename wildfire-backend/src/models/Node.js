// Collection nodes: เก็บ snapshot ล่าสุดของแต่ละโหนดสำหรับหน้า Dashboard
const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema(
  {
    // ตัวตนและสถานะล่าสุด
    node_id: { type: String, required: true, unique: true, index: true, trim: true },
    state: {
      type: String,
      enum: ['UNKNOWN', 'NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT'],
      default: 'UNKNOWN',
      index: true
    },
    // ค่าที่ตรวจวัดล่าสุด
    air_temp: { type: Number },
    humidity: { type: Number },
    particle_adc: { type: Number, min: 0, max: 4095 },
    sensor_health: { type: String },
    // ตำแหน่งล่าสุดจาก GPS หรือ Admin
    lat: { type: Number },
    lng: { type: Number },
    gps_fixed: { type: Boolean, default: false },
    gps_error: { type: String },
    location_source: { type: String, enum: ['gps', 'manual'] },
    location_updated_at: { type: Date },
    // ข้อมูลรอบส่งและคุณภาพสัญญาณล่าสุด
    last_seen: { type: Date },
    session_id: { type: Number },
    last_seq: { type: Number },
    report_interval_sec: { type: Number },
    rssi: { type: Number },
    snr: { type: Number }
  },
  {
    collection: 'nodes',
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

module.exports = mongoose.model('Node', nodeSchema);
