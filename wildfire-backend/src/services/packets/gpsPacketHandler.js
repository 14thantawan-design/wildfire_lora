// บันทึกตำแหน่ง GPS หรือรหัสข้อผิดพลาดลงเอกสาร Node
const NodeModel = require('../../models/Node');

// อัปเดตพิกัดล่าสุดของโหนดเมื่อได้รับแพ็กเก็ต GPS
async function handleGpsPacket(packet) {
  const nodeId = packet.id;
  const now = new Date();
  const gpsFixed = packet.gf === 1;
  const nodeSet = {
    last_seen: now,
    gps_fixed: gpsFixed,
    rssi: packet.rssi,
    snr: packet.snr
  };

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
