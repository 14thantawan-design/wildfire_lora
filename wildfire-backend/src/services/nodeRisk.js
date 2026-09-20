// ทำให้ชื่อสถานะอยู่ในรูปแบบมาตรฐาน และคืน UNKNOWN เมื่อค่าไม่รองรับ
function normalizeRiskState(value) {
  const state = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (['NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT'].includes(state)) return state;
  return 'UNKNOWN';
}

// คัดลอกผลประเมินจาก firmware โดย Backend ไม่คำนวณเกณฑ์ความเสี่ยงซ้ำ
function riskFromPacket(packet) {
  return {
    state: normalizeRiskState(packet.st)
  };
}

// แปลง Mongoose document เป็น object และปรับสถานะก่อนส่งออก API
function normalizeNodeRisk(record) {
  const obj = record.toObject ? record.toObject() : { ...record };
  obj.state = normalizeRiskState(obj.state);
  return obj;
}

module.exports = {
  normalizeNodeRisk,
  normalizeRiskState,
  riskFromPacket
};
