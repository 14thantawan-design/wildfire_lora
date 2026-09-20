// กฎตรวจรูปแบบและช่วงค่าของแพ็กเก็ตก่อนอนุญาตให้เขียน MongoDB
const {
  isFiniteNumber,
  isValidCoordinate,
  isValidNodeId,
  isValidSequence,
  isValidSessionId
} = require('./packetHelpers');

const SENSOR_STATES = new Set(['NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT']);
const SENSOR_HEALTH_VALUES = new Set(['OK', 'FAULT']);
const SENSOR_PACKET_FIELDS = new Set([
  't', 'id', 'q', 'sid', 'ri', 'st', 'at', 'h', 'adc', 'sh',
  'rssi', 'RSSI', 'rs', 'snr', 'SNR'
]);

// ตรวจตัวเลขที่ยอมให้เป็น null แต่ถ้ามีค่าต้องอยู่ในช่วงที่กำหนด
function validateOptionalNumber(packet, key, minimum, maximum) {
  const value = packet[key];
  if (value === undefined || value === null) return null;
  if (!isFiniteNumber(value) || value < minimum || value > maximum) {
    return `${key} is out of range`;
  }
  return null;
}

// ตรวจแพ็กเก็ตค่าจาก SHT31 และ Sharp ก่อนบันทึก Reading
function validateSensorPacket(packet) {
  if (packet.t !== 's') return 'sensor packet has invalid type';
  if (Object.keys(packet).some((key) => !SENSOR_PACKET_FIELDS.has(key))) {
    return 'sensor packet contains an unsupported field';
  }
  if (!isValidNodeId(packet.id)) return 'sensor packet has invalid id';
  if (!isValidSequence(packet.q)) return 'sensor packet has invalid sequence';
  if (!isValidSessionId(packet.sid)) return 'sensor packet has invalid session id';

  const state = typeof packet.st === 'string' ? packet.st.trim().toUpperCase() : '';
  const health = typeof packet.sh === 'string' ? packet.sh.trim().toUpperCase() : '';
  if (!SENSOR_STATES.has(state)) return 'sensor packet has invalid state';
  if (!SENSOR_HEALTH_VALUES.has(health)) return 'sensor packet has invalid health';
  if ((state === 'SENSOR_FAULT') !== (health === 'FAULT')) {
    return 'sensor packet state and health disagree';
  }
  if (!Number.isInteger(packet.ri) || packet.ri < 1 || packet.ri > 86400) {
    return 'sensor packet has invalid report interval';
  }

  const hasParticleField = packet.adc !== undefined && packet.adc !== null;
  if (health !== 'FAULT' && !hasParticleField) return 'sensor packet has invalid particle ADC';
  if (hasParticleField && (!Number.isInteger(packet.adc) || packet.adc < 0 || packet.adc > 4095)) {
    return 'sensor packet has invalid particle ADC';
  }

  for (const [key, minimum, maximum] of [['at', -80, 100], ['h', 0, 100]]) {
    const error = validateOptionalNumber(packet, key, minimum, maximum);
    if (error) return error;
  }
  if (health !== 'FAULT' && (!isFiniteNumber(packet.at) || !isFiniteNumber(packet.h))) {
    return 'healthy sensor packet is missing temperature or humidity';
  }
  return null;
}

// ตรวจแพ็กเก็ต GPS และบังคับให้มีพิกัดจริงเมื่อระบุว่า fix สำเร็จ
function validateGpsPacket(packet) {
  if (packet.t !== 'gps') return 'gps packet has invalid type';
  if (!isValidNodeId(packet.id)) return 'gps packet has invalid id';
  if (!isValidSequence(packet.q)) return 'gps packet has invalid sequence';
  if (!isValidSessionId(packet.sid)) return 'gps packet has invalid session id';
  if (packet.gf !== 0 && packet.gf !== 1) return 'gps packet has invalid fix flag';
  if (packet.gf === 1 && !isValidCoordinate(packet.la, packet.ln)) {
    return 'gps packet has invalid coordinates';
  }
  if (packet.er !== undefined && (typeof packet.er !== 'string' || packet.er.length > 64)) {
    return 'gps packet has invalid error code';
  }
  return null;
}

module.exports = { validateGpsPacket, validateSensorPacket };
