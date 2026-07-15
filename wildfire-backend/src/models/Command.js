const mongoose = require('mongoose');

const commandSchema = new mongoose.Schema(
  {
    command_id: { type: String, required: true, unique: true, index: true },
    node_id: { type: String, required: true, index: true, trim: true },
    command: { type: String, required: true, enum: ['gps_reacquire'] },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'sent', 'acknowledged'],
      default: 'pending',
      index: true
    },
    sent_at: { type: Date },
    acknowledged_at: { type: Date },
    attempts: { type: Number, default: 0 },
    expires_at: { type: Date, required: true }
  },
  {
    collection: 'commands',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

commandSchema.index({ status: 1, expires_at: 1, created_at: 1 });
commandSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Command', commandSchema);
