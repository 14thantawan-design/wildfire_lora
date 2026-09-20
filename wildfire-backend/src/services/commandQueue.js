// จัดคิวและติดตามสถานะคำสั่ง GPS ที่ Backend รอส่งผ่าน Gateway
const crypto = require('crypto');
const Command = require('../models/Command');

const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;

// สร้างรหัสคำสั่งที่ไม่ซ้ำจากเวลาและข้อมูลสุ่ม
function createCommandId() {
  return `cmd_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

// เลือกเฉพาะ field ที่ Gateway และ API ต้องใช้จาก Command document
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
    completed_at: value.completed_at,
    result_reason: value.result_reason,
    attempts: value.attempts
  };
}

// เพิ่มคำสั่งใหม่ หรือคืนคำสั่งเดิมเมื่อมีคำสั่งชนิดเดียวกันรออยู่แล้ว
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

// คืนชื่อคำสั่ง GPS ที่ให้ผลตรงข้ามกับคำสั่งใหม่
function oppositeGpsCommand(commandName) {
  if (commandName === 'gps_manual') return 'gps_reacquire';
  if (commandName === 'gps_reacquire') return 'gps_manual';
  return null;
}

// ยกเลิกคำสั่ง GPS เดิมที่ขัดแย้ง แล้วเก็บคำสั่งล่าสุดไว้เพียงชนิดเดียว
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

// คืนคำสั่งที่ยังไม่หมดอายุและยังรอ Gateway ดำเนินการ
async function listPendingCommands() {
  const commands = await Command.find({
    command: { $in: ['gps_reacquire', 'gps_manual'] },
    status: { $in: ['pending', 'sent'] },
    completed_at: null,
    expires_at: { $gt: new Date() }
  }).sort({ created_at: 1 });
  return commands.map(serializeCommand);
}

// เปลี่ยนสถานะเป็น sent และนับจำนวนครั้งที่ Gateway พยายามส่ง
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

// ปิดคำสั่งด้วยผล acknowledged หรือ rejected จากโหนด
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

module.exports = {
  completeCommand,
  enqueueCommand,
  enqueueLatestGpsCommand,
  listPendingCommands,
  markCommandSent,
  oppositeGpsCommand
};
