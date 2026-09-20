// ฟังก์ชันพื้นฐานที่ใช้ร่วมกันระหว่างแพ็กเก็ต Sensor และ GPS
const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

// คืนค่าแรกที่ไม่ใช่ undefined หรือ null
function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

// เพิ่มฟิลด์ลง object เฉพาะเมื่อมีค่าจริง
function setIfDefined(target, key, value) {
  if (value !== undefined && value !== null) target[key] = value;
}

// แปลงค่าเป็น Number และคืน undefined เมื่อแปลงไม่ได้
function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// แปลงค่าเป็น Number โดยใช้ null แทนค่าที่ไม่มี
function toNullableNumber(value) {
  const parsed = toNumber(value);
  return parsed === undefined ? null : parsed;
}

// อ่านตัวเลขจาก packet โดยแยกกรณีไม่มี field กับ field ที่มีค่า null
function packetNumber(packet, key) {
  return Object.prototype.hasOwnProperty.call(packet, key)
    ? toNullableNumber(packet[key])
    : undefined;
}

// ตรวจว่าเป็นตัวเลขจริงที่ไม่ใช่ NaN หรือ Infinity
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// ตรวจเลขลำดับแพ็กเก็ตแบบ unsigned 32-bit
function isValidSequence(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

// ตรวจรหัสรอบเปิดเครื่องแบบ unsigned 32-bit ที่ห้ามเป็นศูนย์
function isValidSessionId(value) {
  return Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}

// ตรวจรหัสโหนดให้มีเฉพาะอักษร ตัวเลข ขีดกลาง และขีดล่าง
function isValidNodeId(value) {
  return typeof value === 'string' && NODE_ID_PATTERN.test(value.trim());
}

// ตรวจช่วงละติจูด/ลองจิจูดและไม่ยอมรับพิกัด 0,0
function isValidCoordinate(latitude, longitude) {
  return isFiniteNumber(latitude) && isFiniteNumber(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180 &&
    (Math.abs(latitude) >= 0.000001 || Math.abs(longitude) >= 0.000001);
}

// สร้าง key ที่ระบุ Reading หนึ่งรายการไม่ให้บันทึกซ้ำ
function readingIdentity(packet) {
  return { node_id: packet.id.trim(), session_id: packet.sid, seq: packet.q };
}

// ตรวจว่าแพ็กเก็ตมาช้ากว่าแพ็กเก็ตล่าสุดใน session เดียวกันหรือไม่
function isOutOfOrderPacket(node, packet) {
  if (!node || !isValidSessionId(packet.sid) || !isValidSequence(packet.q)) return false;
  if (!isValidSessionId(node.session_id) || !isValidSequence(node.last_seq)) return false;
  return node.session_id === packet.sid && packet.q <= node.last_seq;
}

// สร้างผลลัพธ์มาตรฐานเมื่อ Backend ไม่รับแพ็กเก็ต
function invalidPacket(reason) {
  return { ignored: true, invalid: true, reason };
}

// อ่าน RSSI จากชื่อ field ที่ Gateway รุ่นต่าง ๆ อาจส่งมา
function extractRssi(packet, meta) {
  return toNumber(firstDefined(packet.rssi, packet.RSSI, packet.rs, meta && meta.rssi));
}

// อ่าน SNR จากชื่อ field ที่ Gateway รุ่นต่าง ๆ อาจส่งมา
function extractSnr(packet, meta) {
  return toNumber(firstDefined(packet.snr, packet.SNR, meta && meta.snr));
}

module.exports = {
  extractRssi,
  extractSnr,
  invalidPacket,
  isFiniteNumber,
  isOutOfOrderPacket,
  isValidCoordinate,
  isValidNodeId,
  isValidSequence,
  isValidSessionId,
  packetNumber,
  readingIdentity,
  setIfDefined,
  toNumber
};
