// Collection nodes: เก็บ snapshot ล่าสุดของแต่ละโหนดสำหรับหน้า Dashboard
const mongoose = require('mongoose');
const Any = mongoose.Schema.Types.Mixed;

const nodeSchema = new mongoose.Schema(
  {
    // ตัวตนและสถานะล่าสุด
    node_id: { type: String, unique: true, index: true },
    registration_status: {
      type: String, enum: ['legacy', 'pending', 'active', 'archived'], default: 'legacy'
    },
    credential_generation: { type: String },
    credential_ciphertext: { type: String, select: false },
    provisioning_challenge: { type: String, select: false },
    provisioning_expires_at: { type: Date },
    uplink_sequence: { type: Number, default: 0, select: false },
    archived_at: { type: Date },
    state: {
      type: String,
      default: 'UNKNOWN',
      index: true
    },
    // ค่าที่ตรวจวัดล่าสุด
    air_temp: { type: Any },
    humidity: { type: Any },
    particle_adc: { type: Any },
    // ตำแหน่งล่าสุดจาก GPS หรือ Admin
    lat: { type: Any },
    lng: { type: Any },
    gps_fixed: { type: Boolean, default: false },
    gps_error: { type: String },
    location_source: { type: String },
    location_updated_at: { type: Date },
    // ข้อมูลรอบส่งและคุณภาพสัญญาณล่าสุด
    last_seen: { type: Date },
    report_interval_sec: { type: Any },
    rssi: { type: Any },
    snr: { type: Any }
  },
  {
    collection: 'nodes',
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

module.exports = mongoose.model('Node', nodeSchema);
