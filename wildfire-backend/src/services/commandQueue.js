const crypto = require('crypto');
const Command = require('../models/Command');

const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;
const listeners = new Set();

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
    attempts: value.attempts
  };
}

async function enqueueCommand(nodeId, commandName) {
  const now = new Date();
  const existing = await Command.findOne({
    node_id: nodeId,
    command: commandName,
    status: { $in: ['pending', 'sent'] },
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

  for (const listener of listeners) {
    try {
      listener(serialized);
    } catch (error) {
      console.error(`command listener error: ${error.message}`);
    }
  }

  return { command: serialized, duplicate: false };
}

async function listPendingCommands() {
  const commands = await Command.find({
    status: { $in: ['pending', 'sent'] },
    expires_at: { $gt: new Date() }
  }).sort({ created_at: 1 });
  return commands.map(serializeCommand);
}

async function markCommandSent(commandId) {
  const command = await Command.findOneAndUpdate(
    {
      command_id: commandId,
      status: { $in: ['pending', 'sent'] },
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

async function acknowledgeCommand(commandId) {
  const command = await Command.findOneAndUpdate(
    { command_id: commandId, status: { $in: ['pending', 'sent'] } },
    { $set: { status: 'acknowledged', acknowledged_at: new Date() } },
    { new: true }
  );
  return Boolean(command);
}

function onCommand(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = {
  acknowledgeCommand,
  enqueueCommand,
  listPendingCommands,
  markCommandSent,
  onCommand
};
