// บันทึกตำแหน่ง GPS หรือรหัสข้อผิดพลาดลงเอกสาร Node
const NodeModel = require('../../models/Node');
const { validateGpsPacket } = require('./packetValidation');
const {
  extractRssi,
  extractSnr,
  invalidPacket,
  isOutOfOrderPacket,
  isValidSessionId,
  setIfDefined,
  toNumber
} = require('./packetHelpers');

// ตรวจลำดับแพ็กเก็ตแล้วอัปเดตพิกัดล่าสุดของโหนด
async function handleGpsPacket(packet, meta = {}) {
  const validationError = validateGpsPacket(packet);
  if (validationError) return invalidPacket(validationError);

  const nodeId = packet.id.trim();
  const now = new Date();
  const currentNode = await NodeModel.findOne({ node_id: nodeId })
    .select('session_id last_seq')
    .lean();
  if (isOutOfOrderPacket(currentNode, packet)) {
    return { type: 'gps', node_id: nodeId, ignored: true, stale: true, seq: packet.q };
  }

  const gpsFixed = packet.gf === 1;
  const nodeSet = {
    last_seen: now,
    session_id: isValidSessionId(packet.sid) ? packet.sid : undefined,
    last_seq: toNumber(packet.q),
    gps_fixed: gpsFixed
  };
  setIfDefined(nodeSet, 'rssi', extractRssi(packet, meta));
  setIfDefined(nodeSet, 'snr', extractSnr(packet, meta));

  const update = { $set: nodeSet, $setOnInsert: { node_id: nodeId } };
  if (gpsFixed) {
    nodeSet.lat = packet.la;
    nodeSet.lng = packet.ln;
    nodeSet.location_source = 'gps';
    nodeSet.location_updated_at = now;
    update.$unset = { gps_error: '' };
  } else if (packet.er) {
    nodeSet.gps_error = packet.er;
  }

  await NodeModel.findOneAndUpdate(
    { node_id: nodeId },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { type: 'gps', node_id: nodeId, gps_fixed: gpsFixed };
}

module.exports = { handleGpsPacket };
