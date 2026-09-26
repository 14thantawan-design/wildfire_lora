// บันทึกแพ็กเก็ตเซนเซอร์เป็น Reading อัปเดต Node และส่งต่อให้ระบบ Alert
const NodeModel = require('../../models/Node');
const Reading = require('../../models/Reading');
const { processAlertForReading } = require('../alertService');

// รับข้อมูลเซนเซอร์ บันทึก Reading และอัปเดตค่าล่าสุดของ Node
async function handleSensorPacket(packet) {
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

  const reading = await Reading.create({ node_id: nodeId, timestamp: now, ...values });

  await NodeModel.findOneAndUpdate(
    { node_id: nodeId },
    { $set: { ...values, last_seen: now }, $setOnInsert: { node_id: nodeId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

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
