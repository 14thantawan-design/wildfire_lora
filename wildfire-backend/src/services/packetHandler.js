// จุดรับแพ็กเก็ตกลาง: เลือก handler ตามชนิดข้อมูลและคง export เดิมให้ส่วนอื่นเรียกใช้
const { handleSensorPacket } = require('./packets/sensorPacketHandler');
const { handleGpsPacket } = require('./packets/gpsPacketHandler');
const { validateSensorPacket, validateGpsPacket } = require('./packets/packetValidation');
const {
  invalidPacket,
  isOutOfOrderPacket,
  readingIdentity
} = require('./packets/packetHelpers');

// ส่งแพ็กเก็ตไปยัง Sensor หรือ GPS handler และปฏิเสธชนิดที่ไม่รองรับ
async function handlePacket(packet, meta = {}) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return invalidPacket('invalid packet');
  }
  if (packet.t === 's') return handleSensorPacket(packet, meta);
  if (packet.t === 'gps') return handleGpsPacket(packet, meta);
  return invalidPacket(`unsupported packet type: ${packet.t}`);
}

module.exports = {
  handlePacket,
  handleSensorPacket,
  handleGpsPacket,
  validateSensorPacket,
  validateGpsPacket,
  readingIdentity,
  isOutOfOrderPacket
};
