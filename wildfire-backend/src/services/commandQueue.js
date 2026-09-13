const crypto = require('crypto');
const Command = require('../models/Command');

const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;

function createCommandId() {
  return `cmd_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function serializeCommand(command) {
  const value = command?.toObject ? command.toObject() : command;
  if (!value) return null;
  return {
    command_id: value.command_id,
    node_id: value.node_id,
    command: value.command,
    status: value.status,
    created_at: value.created_at,
    sent_at: value.sent_at,
    acknowledged_at: value.acknowledged_at,
    baseline_started_at: value.baseline_started_at,
    completed_at: value.completed_at,
    result_reason: value.result_reason,
    attempts: value.attempts
  };
}

async function enqueueCommand(nodeId, commandName) {
  const now = new Date();
  const existing = await Command.findOne({
    node_id: nodeId,
    command: commandName,
    status: { $in: ['pending', 'sent'] },
    completed_at: null,
    expires_at: { $gt: now }
  }).sort({ created_at: -1 });

  if (existing) return { command: serializeCommand(existing), duplicate: true };

  const command = await Command.create({
    command_id: createCommandId(),
    node_id: nodeId,
    command: commandName,
    status: 'pending',
    expires_at: new Date(now.getTime() + COMMAND_TTL_MS)
  });
  const serialized = serializeCommand(command);

  return { command: serialized, duplicate: false };
}

function oppositeGpsCommand(commandName) {
  if (commandName === 'gps_manual') return 'gps_reacquire';
  if (commandName === 'gps_reacquire') return 'gps_manual';
  return null;
}

async function enqueueLatestGpsCommand(nodeId, commandName) {
  const supersededCommand = oppositeGpsCommand(commandName);
  if (!supersededCommand) {
    throw new Error('unsupported GPS command');
  }

  const now = new Date();
  await Command.updateMany(
    {
      node_id: nodeId,
      command: supersededCommand,
      status: { $in: ['pending', 'sent'] },
      completed_at: null,
      expires_at: { $gt: now }
    },
    {
      $set: {
        status: 'rejected',
        acknowledged_at: now,
        result_reason: `superseded_by_${commandName}`
      }
    }
  );

  return enqueueCommand(nodeId, commandName);
}

async function listPendingCommands() {
  const commands = await Command.find({
    status: { $in: ['pending', 'sent'] },
    completed_at: null,
    expires_at: { $gt: new Date() }
  }).sort({ created_at: 1 });
  return commands.map(serializeCommand);
}

async function markCommandSent(commandId) {
  const command = await Command.findOneAndUpdate(
    {
      command_id: commandId,
      status: { $in: ['pending', 'sent'] },
      completed_at: null,
      expires_at: { $gt: new Date() }
    },
    {
      $set: { status: 'sent', sent_at: new Date() },
      $inc: { attempts: 1 }
    },
    { new: true }
  );
  return serializeCommand(command);
}

async function completeCommand(commandId, accepted = true, reason = '') {
  const status = accepted ? 'acknowledged' : 'rejected';
  const command = await Command.findOneAndUpdate(
    { command_id: commandId, status: { $in: ['pending', 'sent'] }, completed_at: null },
    {
      $set: {
        status,
        acknowledged_at: new Date(),
        result_reason: accepted ? '' : String(reason || 'rejected').slice(0, 80)
      }
    },
    { new: true }
  );
  return serializeCommand(command);
}

async function getLatestCommandForNode(nodeId, commandName) {
  const command = await Command.findOne({ node_id: nodeId, command: commandName })
    .sort({ created_at: -1 });
  return serializeCommand(command);
}

function isBaselineCalibrationInProgress(telemetry = {}) {
  const state = String(telemetry.node_state || telemetry.state || '').toUpperCase();
  const sensorHealth = String(telemetry.sensor_health || '').toUpperCase();
  const count = Number(telemetry.baseline_warmup_count);
  const target = Number(telemetry.baseline_warmup_target);
  const countStillLearning = telemetry.baseline_warmup_count !== null &&
    telemetry.baseline_warmup_count !== undefined &&
    telemetry.baseline_warmup_target !== null &&
    telemetry.baseline_warmup_target !== undefined &&
    Number.isFinite(count) && Number.isFinite(target) && target > 0 && count < target;

  return state === 'CALIBRATING' ||
    sensorHealth === 'CAL' || sensorHealth === 'CALIBRATING' || countStillLearning;
}

function buildBaselineProgressUpdate(command, telemetry = {}, timestamp = new Date()) {
  const inProgress = isBaselineCalibrationInProgress(telemetry);
  const sensorHealth = String(telemetry.sensor_health || '').toUpperCase();
  const set = {};
  const unset = {};

  if (inProgress) {
    if (!command.baseline_started_at) set.baseline_started_at = timestamp;
    // Repair commands that older logic marked completed when a calibrating node
    // temporarily reported WATCH/WARNING before its warm-up count was finished.
    if (command.completed_at) unset.completed_at = 1;
  } else if (sensorHealth === 'OK' && command.baseline_started_at) {
    if (!command.completed_at) set.completed_at = timestamp;
    // CAL followed by OK confirms completion even when the separate radio ACK
    // was lost. Close the delivery queue without inventing an ACK timestamp.
    if (command.status === 'sent') {
      set.status = 'acknowledged';
      set.result_reason = 'baseline_completion_observed';
    }
  }

  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return Object.keys(update).length > 0 ? update : null;
}

async function recordBaselineRecalibrationProgress(nodeId, telemetry, timestamp = new Date()) {
  const command = await Command.findOne({
    node_id: nodeId,
    command: 'baseline_recalibrate',
    status: { $in: ['sent', 'acknowledged'] }
  }).sort({ created_at: -1 });
  if (!command) return null;

  const update = buildBaselineProgressUpdate(command, telemetry, timestamp);
  if (!update) return serializeCommand(command);

  const updated = await Command.findOneAndUpdate(
    { _id: command._id, status: command.status, updated_at: command.updated_at },
    update,
    { new: true }
  );
  return serializeCommand(updated);
}

module.exports = {
  buildBaselineProgressUpdate,
  completeCommand,
  enqueueCommand,
  enqueueLatestGpsCommand,
  getLatestCommandForNode,
  isBaselineCalibrationInProgress,
  listPendingCommands,
  markCommandSent,
  oppositeGpsCommand,
  recordBaselineRecalibrationProgress
};
