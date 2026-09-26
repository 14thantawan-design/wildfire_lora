// ฟังก์ชันแปลง query และตรวจข้อมูลที่ใช้ร่วมกันใน Reading routes
const mongoose = require('mongoose');
const { normalizeNodeRisk } = require('../../services/nodeRisk');

// จำกัดจำนวนผลลัพธ์และใช้ค่า fallback เมื่อ query ไม่ถูกต้อง
function parseLimit(value, fallback = 100) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 5000);
}

// แปลง query วันเวลาเป็น Date
function parseDate(value) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

// แปลงเลขหน้าและป้องกันค่าติดลบหรือค่าที่ไม่ใช่ตัวเลข
function parsePage(value) {
  const parsed = Number(value || 1);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.floor(parsed);
}

// ตรวจขนาดช่วงเฉลี่ยของกราฟให้อยู่ระหว่าง 10 วินาทีกับ 7 วัน
function parseBucketMs(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 10000 || parsed > 7 * 24 * 60 * 60 * 1000) {
    return undefined;
  }
  return Math.floor(parsed);
}

// แปลง Mongoose document เป็นข้อมูลที่ API ส่งให้ Dashboard
function serializeReading(reading) {
  return normalizeNodeRisk(reading);
}

// สร้าง Error 400 สำหรับคำขอ Admin ที่ทำงานต่อไม่ได้
function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// ส่งค่าที่ Admin แก้ได้เข้า MongoDB โดยไม่ตรวจช่วงของข้อมูล
function buildReadingUpdate(input) {
  const set = {};
  for (const field of ['air_temp', 'humidity', 'particle_adc', 'rssi', 'snr', 'timestamp']) {
    if (Object.hasOwn(input || {}, field)) set[field] = input[field];
  }
  return { $set: set };
}

// ตรวจและตัด id ซ้ำก่อนลบ Reading หลายรายการ
function normalizeReadingIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest('ids must be a non-empty array');
  }
  const ids = [...new Set(value.map((id) => String(id)))];
  if (ids.length > 500) throw badRequest('cannot delete more than 500 readings at once');
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw badRequest('one or more reading ids are invalid');
  }
  return ids;
}

// ตรวจ node_id ที่ใช้เป็นขอบเขตการลบข้อมูลทั้งหมดของหนึ่งโหนด
function normalizeNodeId(value) {
  const nodeId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(nodeId)) throw badRequest('node_id is invalid');
  return nodeId;
}

module.exports = {
  buildReadingUpdate,
  normalizeNodeId,
  normalizeReadingIds,
  parseBucketMs,
  parseDate,
  parseLimit,
  parsePage,
  serializeReading
};
