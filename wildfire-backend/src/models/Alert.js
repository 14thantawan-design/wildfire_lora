const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    node_id: { type: String, required: true, trim: true },
    level: {
      type: String,
      required: true,
      enum: ['WATCH', 'WARNING', 'CRITICAL', 'SENSOR_FAULT'],
      index: true
    },
    started_at: { type: Date, required: true, index: true },
    ended_at: { type: Date },
    active: { type: Boolean, default: true, index: true },
    max_confidence: { type: Number },
    max_risk_score: { type: Number },
    max_state: {
      type: String,
      enum: ['WATCH', 'WARNING', 'CRITICAL', 'SENSOR_FAULT'],
      index: true
    },
    reasons: { type: [String], default: [] },
    message: { type: String },
    last_reading: { type: mongoose.Schema.Types.Mixed },
    telegram_notified_level: {
      type: String,
      enum: ['WATCH', 'WARNING', 'CRITICAL', 'SENSOR_FAULT']
    },
    telegram_notified_at: { type: Date },
    telegram_resolved_notified_at: { type: Date },
    telegram_last_error: { type: String }
  },
  {
    collection: 'alerts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

alertSchema.index(
  { node_id: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);
alertSchema.index({ node_id: 1, started_at: -1 });
alertSchema.index({ active: 1, started_at: -1 });

module.exports = mongoose.model('Alert', alertSchema);
