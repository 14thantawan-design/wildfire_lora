// Collection readings: เก็บประวัติการวัดทุกแพ็กเก็ตเพื่อใช้กราฟย้อนหลัง
const mongoose = require('mongoose');

const readingSchema = new mongoose.Schema(
  {
    // ตัวตนของ Reading และเวลาที่ Backend รับข้อมูล
    node_id: { type: String, required: true, index: true, trim: true },
    session_id: { type: Number },
    report_interval_sec: { type: Number },
    seq: { type: Number, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    // ผลประเมินจาก firmware และค่าที่เซนเซอร์วัดได้
    state: {
      type: String,
      enum: ['NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT'],
      index: true
    },
    air_temp: { type: Number },
    humidity: { type: Number },
    particle_adc: { type: Number, min: 0, max: 4095 },
    sensor_health: { type: String },
    rssi: { type: Number },
    snr: { type: Number }
  },
  {
    collection: 'readings',
    versionKey: false
  }
);

// เร่งการค้นหากราฟ และป้องกันแพ็กเก็ตเดิมถูกบันทึกซ้ำ
readingSchema.index({ node_id: 1, timestamp: -1 });
readingSchema.index({ node_id: 1, seq: -1 });
readingSchema.index({ node_id: 1, session_id: 1, seq: 1 }, { unique: true });

module.exports = mongoose.model('Reading', readingSchema);
