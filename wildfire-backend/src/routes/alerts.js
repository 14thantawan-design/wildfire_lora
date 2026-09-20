// API สำหรับอ่านเหตุการณ์แจ้งเตือน และให้ Admin ลบเหตุการณ์ที่ไม่ต้องการเก็บ
const express = require('express');
const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const { normalizeNodeRisk } = require('../services/nodeRisk');
const { requireLocalAdmin } = require('../middleware/security');

const router = express.Router();

// แปลง Mongoose document เป็น JSON และทำให้ชื่อสถานะอยู่ในรูปแบบเดียวกัน
function serializeAlert(alert) {
  const obj = alert.toObject ? alert.toObject() : { ...alert };
  if (obj.last_reading) obj.last_reading = normalizeNodeRisk(obj.last_reading);
  return obj;
}

// ตรวจและจำกัดจำนวน Alert ที่ client ขอ เพื่อไม่ให้ query ใหญ่เกินไป
function parseLimit(value, fallback = 100) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 1000);
}

// GET /api/alerts/active คืนเฉพาะเหตุการณ์ที่ยังไม่สิ้นสุด
router.get('/active', async (req, res, next) => {
  try {
    const alerts = await Alert.find({ active: true }).sort({ started_at: -1 });
    res.json(alerts.map(serializeAlert));
  } catch (error) {
    next(error);
  }
});

// GET /api/alerts คืนประวัติเหตุการณ์ตามตัวกรอง active และ limit
router.get('/', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 100);
    const query = {};
    if (req.query.active === 'true') query.active = true;
    if (req.query.active === 'false') query.active = false;

    const alerts = await Alert.find(query).sort({ started_at: -1 }).limit(limit);
    res.json(alerts.map(serializeAlert));
  } catch (error) {
    next(error);
  }
});

// DELETE /api/alerts/:id ให้ Admin ลบ Alert หนึ่งรายการ
router.delete('/:id', requireLocalAdmin, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'invalid alert id' });
    }

    const alert = await Alert.findByIdAndDelete(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'alert not found' });
    }

    return res.json({ deleted: true, alert_id: req.params.id });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.serializeAlert = serializeAlert;
