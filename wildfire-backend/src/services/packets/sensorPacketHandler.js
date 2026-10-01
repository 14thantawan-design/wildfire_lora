// บันทึกแพ็กเก็ตเซนเซอร์เป็น Reading อัปเดต Node และส่งต่อให้ระบบ Alert
const NodeModel = require('../../models/Node');
const Reading = require('../../models/Reading');
const { processAlertForReading } = require('../alertService');

// รับข้อมูลเซนเซอร์ บันทึก Reading และอัปเดตค่าล่าสุดของ Node
async function handleSensorPacket(packet, generation) {
  const nodeId = packet.id;
  const now = new Date();

  const values = {
    report_interval_sec: packet.ri,
    state: packet.st,
    air_temp: packet.at,
    humidity: packet.h,
    particle_adc: packet.adc,
    rssi: packet.rssi,
    snr: packet.snr
  };

  const node = await NodeModel.findOneAndUpdate(
    { node_id: nodeId, registration_status: 'active', credential_generation: generation },
    { $set: { ...values, last_seen: now } },
    { new: true }
  );
  if (!node) return { ignored: true, reason: 'node credentials revoked' };
  const reading = await Reading.create({ node_id: nodeId, credential_generation: generation,
    timestamp: now, ...values });

  const alertResult = await processAlertForReading(reading);
  return {
    type: 'sensor',
    node_id: nodeId,
    reading_id: reading._id,
    risk: { state: packet.st },
    alert: alertResult
  };
}

module.exports = { handleSensorPacket };
