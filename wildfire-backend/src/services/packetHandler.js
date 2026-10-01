// จุดรับแพ็กเก็ตกลาง: เลือก handler ตามชนิดข้อมูลและคง export เดิมให้ส่วนอื่นเรียกใช้
const { handleSensorPacket } = require('./packets/sensorPacketHandler');
const { handleGpsPacket } = require('./packets/gpsPacketHandler');
const NodeModel = require('../models/Node');
const { completeCommand } = require('./commandQueue');
const { decryptUplink, failure, inspectFrame, openDeviceKey, validatePacket } = require('./secureLoRa');

// Authenticate and consume an FG1 frame before dispatching its protected payload.
async function handlePacket(input) {
  const info = inspectFrame(input?.frame);
  const identity = { node_id: info.nodeId, registration_status: 'active',
    credential_generation: info.generation };
  const node = await NodeModel.findOne(identity).select('+credential_ciphertext');
  if (!node) throw failure('node is not registered or credentials are revoked', 401);
  const key = openDeviceKey(node.credential_ciphertext, node.node_id, info.generation);
  const { packet } = decryptUplink(input.frame, key);
  validatePacket(packet);
  for (const field of ['rssi', 'snr']) {
    if (input[field] !== undefined && (typeof input[field] !== 'number' || !Number.isFinite(input[field]))) {
      throw failure('invalid radio metadata');
    }
    packet[field] = input[field];
  }
  // Durable atomic compare-and-set; neither concurrent copies nor an archived key may pass.
  const accepted = await NodeModel.findOneAndUpdate({ ...identity,
    uplink_sequence: { $lt: info.sequence }
  }, { $set: { uplink_sequence: info.sequence } }, { new: true });
  if (!accepted) throw failure('stale, replayed, or revoked packet', 409);
  if (packet.t === 's') return handleSensorPacket(packet, info.generation);
  if (packet.t === 'gps') return handleGpsPacket(packet, info.generation);
  const command = await completeCommand(packet.cid, packet.ok === 1, packet.r,
    info.nodeId, info.generation);
  return { type: 'command_ack', node_id: info.nodeId, acknowledged: Boolean(command) };
}

module.exports = {
  handlePacket,
  handleSensorPacket,
  handleGpsPacket
};
