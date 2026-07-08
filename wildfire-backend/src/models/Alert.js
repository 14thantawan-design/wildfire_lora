const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    node_id: { type: String, required: true, index: true, trim: true },
    level: {
      type: String,
      required: true,
      enum: ['WATCH', 'WARNING', 'CRITICAL', 'SENSOR_FAULT'],
      index: true
    },
    started_at: { type: Date, required: true, index: true },
    ended_at: { type: Date },
    active: { type: Boolean, default: true, index: true },
    max_confidence: { type: Number, default: 0 },
    message: { type: String },
    last_reading: { type: mongoose.Schema.Types.Mixed }
  },
  {
    collection: 'alerts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

alertSchema.index({ node_id: 1, active: 1 });
alertSchema.index({ active: 1, started_at: -1 });

module.exports = mongoose.model('Alert', alertSchema);
