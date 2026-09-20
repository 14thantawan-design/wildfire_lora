// API ที่ Cloudflare Access อนุญาตให้ Admin ใช้ค้นหา แก้ไข และลบ Reading
const express = require('express');
const mongoose = require('mongoose');
const Reading = require('../../models/Reading');
const { requireLocalAdmin } = require('../../middleware/security');
const {
  buildReadingUpdate,
  normalizeNodeId,
  normalizeReadingIds,
  parseLimit,
  parsePage,
  serializeReading
} = require('./readingTools');

const router = express.Router();
router.use(requireLocalAdmin);

// คืนข้อมูลแบบแบ่งหน้าให้ตาราง Admin
router.get('/', async (req, res, next) => {
  try {
    const page = parsePage(req.query.page);
    const limit = Math.min(parseLimit(req.query.limit, 50), 200);
    const nodeId = typeof req.query.node_id === 'string' ? req.query.node_id.trim() : '';
    const query = nodeId ? { node_id: nodeId } : {};
    const [readings, total, nodeIds] = await Promise.all([
      Reading.find(query).sort({ timestamp: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
      Reading.countDocuments(query),
      Reading.distinct('node_id')
    ]);
    return res.json({
      items: readings.map(serializeReading),
      total,
      page,
      limit,
      node_ids: nodeIds.sort()
    });
  } catch (error) {
    return next(error);
  }
});

// แก้ไขค่าที่อนุญาตของ Reading หนึ่งรายการ
router.patch('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'invalid reading id' });
    }
    const reading = await Reading.findByIdAndUpdate(
      req.params.id,
      buildReadingUpdate(req.body),
      { new: true, runValidators: true }
    );
    if (!reading) return res.status(404).json({ error: 'reading not found' });
    return res.json(serializeReading(reading));
  } catch (error) {
    return next(error);
  }
});

// ลบ Reading หลายรายการจาก id ที่เลือกในตาราง
router.delete('/', async (req, res, next) => {
  try {
    const ids = normalizeReadingIds(req.body?.ids);
    const result = await Reading.deleteMany({ _id: { $in: ids } });
    return res.json({ requested: ids.length, deleted: result.deletedCount });
  } catch (error) {
    return next(error);
  }
});

// ลบ Reading ทั้งหมดเฉพาะ node_id ที่ระบุ
router.delete('/node/:node_id', async (req, res, next) => {
  try {
    const nodeId = normalizeNodeId(req.params.node_id);
    const result = await Reading.deleteMany({ node_id: nodeId });
    return res.json({ node_id: nodeId, deleted: result.deletedCount });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
