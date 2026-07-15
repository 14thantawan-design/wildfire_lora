const crypto = require('crypto');

const MAX_PENDING_COMMANDS = 10;
const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;
const pendingCommands = [];
const listeners = new Set();

function pruneExpiredCommands() {
  const oldestAllowed = Date.now() - COMMAND_TTL_MS;

  for (let index = pendingCommands.length - 1; index >= 0; index -= 1) {
    if (new Date(pendingCommands[index].created_at).getTime() < oldestAllowed) {
      pendingCommands.splice(index, 1);
    }
  }
}

function createCommandId() {
  return `cmd_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function enqueueCommand(nodeId, commandName) {
  pruneExpiredCommands();

  const existing = pendingCommands.find(
    (command) => command.node_id === nodeId && command.command === commandName
  );
  if (existing) return { command: existing, duplicate: true };

  const command = {
    command_id: createCommandId(),
    node_id: nodeId,
    command: commandName,
    created_at: new Date().toISOString()
  };

  if (pendingCommands.length >= MAX_PENDING_COMMANDS) pendingCommands.shift();
  pendingCommands.push(command);

  for (const listener of listeners) {
    try {
      listener(command);
    } catch (error) {
      console.error(`command listener error: ${error.message}`);
    }
  }

  return { command, duplicate: false };
}

function listPendingCommands() {
  pruneExpiredCommands();
  return pendingCommands.map((command) => ({ ...command }));
}

function acknowledgeCommand(commandId) {
  const index = pendingCommands.findIndex((command) => command.command_id === commandId);
  if (index < 0) return false;
  pendingCommands.splice(index, 1);
  return true;
}

function onCommand(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = {
  acknowledgeCommand,
  enqueueCommand,
  listPendingCommands,
  onCommand
};
