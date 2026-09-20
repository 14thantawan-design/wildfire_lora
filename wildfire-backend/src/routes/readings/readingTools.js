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

// สร้าง Error 400 สำหรับข้อมูลจากผู้ใช้ที่ไม่ถูกต้อง
function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// ตรวจค่าตัวเลขที่ Admin แก้ไข โดยยอมให้ใช้ null เพื่อล้างค่า
function editableNumber(value, field, minimum, maximum) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw validationError(`${field} is out of range`);
  }
  return value;
}

// เลือกเฉพาะ field ที่ Admin แก้ได้และสร้าง MongoDB $set
function buildReadingUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('reading update must be an object');
  }

  const set = {};
  const numericFields = {
    air_temp: [-80, 100],
    humidity: [0, 100],
    particle_adc: [0, 4095],
    rssi: [-200, 50],
    snr: [-50, 50]
  };
  for (const [field, [minimum, maximum]] of Object.entries(numericFields)) {
    if (!Object.hasOwn(input, field)) continue;
    const value = editableNumber(input[field], field, minimum, maximum);
    if (field === 'particle_adc' && value !== null && !Number.isInteger(value)) {
      throw validationError('particle_adc must be an integer');
    }
    set[field] = value;
  }

  if (Object.hasOwn(input, 'timestamp')) {
    if (typeof input.timestamp !== 'string' || !input.timestamp.trim()) {
      throw validationError('timestamp is invalid');
    }
    const timestamp = new Date(input.timestamp);
    if (Number.isNaN(timestamp.getTime())) throw validationError('timestamp is invalid');
    set.timestamp = timestamp;
  }

  if (Object.hasOwn(input, 'sensor_health')) {
    if (input.sensor_health === null) {
      set.sensor_health = null;
    } else {
      const sensorHealth = typeof input.sensor_health === 'string'
        ? input.sensor_health.trim().toUpperCase()
        : '';
      if (!['OK', 'FAULT'].includes(sensorHealth)) {
        throw validationError('sensor_health is invalid');
      }
      set.sensor_health = sensorHealth;
    }
  }

  if (Object.keys(set).length === 0) {
    throw validationError('no editable reading fields were provided');
  }
  return { $set: set };
}

// ตรวจและตัด id ซ้ำก่อนลบ Reading หลายรายการ
function normalizeReadingIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw validationError('ids must be a non-empty array');
  }
  const ids = [...new Set(value.map((id) => String(id)))];
  if (ids.length > 500) throw validationError('cannot delete more than 500 readings at once');
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw validationError('one or more reading ids are invalid');
  }
  return ids;
}

// ตรวจ node_id ที่ใช้เป็นขอบเขตการลบข้อมูลทั้งหมดของหนึ่งโหนด
function normalizeNodeId(value) {
  const nodeId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(nodeId)) throw validationError('node_id is invalid');
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
