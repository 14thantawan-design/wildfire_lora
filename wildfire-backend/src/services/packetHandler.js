// จุดรับแพ็กเก็ตกลาง: เลือก handler ตามชนิดข้อมูลและคง export เดิมให้ส่วนอื่นเรียกใช้
const { handleSensorPacket } = require('./packets/sensorPacketHandler');
const { handleGpsPacket } = require('./packets/gpsPacketHandler');

// เลือก handler จากชนิดข้อมูลเพียงอย่างเดียว
async function handlePacket(packet) {
  if (packet?.t === 's') return handleSensorPacket(packet);
  if (packet?.t === 'gps') return handleGpsPacket(packet);
  return { ignored: true, reason: `unsupported packet type: ${packet?.t}` };
}

module.exports = {
  handlePacket,
  handleSensorPacket,
  handleGpsPacket
};
