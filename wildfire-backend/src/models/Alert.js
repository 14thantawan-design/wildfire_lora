// Collection alerts: เก็บช่วงเหตุการณ์ WATCH, WARNING และ SENSOR_FAULT
const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    // ระดับ เหตุการณ์ และ Reading ล่าสุดที่ทำให้ Alert เปลี่ยน
    node_id: { type: String },
    level: {
      type: String,
      index: true
    },
    started_at: { type: Date, index: true },
    ended_at: { type: Date },
    active: { type: Boolean, default: true, index: true },
    max_state: {
      type: String, index: true
    },
    message: { type: String },
    last_reading: { type: mongoose.Schema.Types.Mixed },
    // สถานะการส่ง Telegram เพื่อไม่แจ้งระดับเดิมซ้ำ
    telegram_notified_level: {
      type: String
    },
    telegram_notified_at: { type: Date },
    telegram_resolved_notified_at: { type: Date },
    telegram_last_error: { type: String }
  },
  {
    collection: 'alerts',
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

// หนึ่งโหนดมี Alert ที่ active ได้ครั้งละหนึ่งเอกสาร
alertSchema.index(
  { node_id: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);
alertSchema.index({ node_id: 1, started_at: -1 });
alertSchema.index({ active: 1, started_at: -1 });

module.exports = mongoose.model('Alert', alertSchema);
