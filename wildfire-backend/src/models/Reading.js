// Collection readings: เก็บประวัติการวัดทุกแพ็กเก็ตเพื่อใช้กราฟย้อนหลัง
const mongoose = require('mongoose');
const Any = mongoose.Schema.Types.Mixed;

const readingSchema = new mongoose.Schema(
  {
    // ตัวตนของ Reading และเวลาที่ Backend รับข้อมูล
    node_id: { type: String, index: true },
    report_interval_sec: { type: Any },
    timestamp: { type: Date, default: Date.now, index: true },
    // ผลประเมินจาก firmware และค่าที่เซนเซอร์วัดได้
    state: {
      type: String,
      index: true
    },
    air_temp: { type: Any },
    humidity: { type: Any },
    particle_adc: { type: Any },
    rssi: { type: Any },
    snr: { type: Any }
  },
  {
    collection: 'readings',
    versionKey: false
  }
);

// เร่งการค้นหากราฟย้อนหลัง; ทุกแพ็กเก็ตเป็น Reading ใหม่ได้
readingSchema.index({ node_id: 1, timestamp: -1 });

module.exports = mongoose.model('Reading', readingSchema);
