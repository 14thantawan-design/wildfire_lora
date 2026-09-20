// API สำหรับอ่านสถานะล่าสุดของโหนด และจัดการตำแหน่ง GPS ของ Admin
const express = require('express');
const NodeModel = require('../models/Node');
const { normalizeNodeRisk } = require('../services/nodeRisk');
const {
  enqueueLatestGpsCommand
} = require('../services/commandQueue');
const { requireLocalAdmin } = require('../middleware/security');

const router = express.Router();

// คำนวณเวลารอก่อนถือว่าโหนดออฟไลน์: สองรอบส่ง หรือค่า fallback
function offlineTimeoutMs(node) {
  const configuredFallback = Number(process.env.OFFLINE_TIMEOUT_MS || 60000);
  const fallbackMs = Number.isFinite(configuredFallback) && configuredFallback > 0
    ? configuredFallback
    : 60000;
  const expectedIntervalMs = Number(node?.report_interval_sec || 0) * 1000;
  return expectedIntervalMs > 0 ? expectedIntervalMs * 2 : fallbackMs;
}

// เพิ่ม field online ให้ข้อมูล Node ก่อนส่งไปยัง Dashboard
function withOnlineStatus(node) {
  const obj = normalizeNodeRisk(node);
  const lastSeen = obj.last_seen ? new Date(obj.last_seen).getTime() : 0;
  obj.online = lastSeen > 0 && Date.now() - lastSeen <= offlineTimeoutMs(obj);
  // สถานะการเชื่อมต่อแยกจากระดับความเสี่ยงล่าสุดที่โหนดประเมิน
  if (!obj.location_source && obj.gps_fixed && obj.lat !== undefined && obj.lng !== undefined) {
    obj.location_source = 'gps';
  }
  return obj;
}

// เพิ่มสถานะ online ให้ Node ทุกตัวในผลลัพธ์
function buildNodeStatusList(nodes) {
  return nodes.map(withOnlineStatus);
}

// ตรวจช่วงละติจูดและลองจิจูด รวมถึงไม่ยอมรับพิกัด 0,0
function isValidCoordinate(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return Math.abs(latitude) >= 0.000001 || Math.abs(longitude) >= 0.000001;
}

// สร้างคำสั่งอัปเดต Node เมื่อ Admin ขอให้ค้นหา GPS ใหม่
function buildGpsReacquireUpdate(node) {
  const unset = {};

  // เก็บพิกัดที่ Admin กรอกไว้เป็น fallback ระหว่างค้นหา GPS
  if (node?.location_source !== 'manual') {
    unset.lat = '';
    unset.lng = '';
    unset.location_source = '';
    unset.location_updated_at = '';
  }

  return {
    $set: { gps_fixed: false, gps_error: 'gps_reacquiring' },
    $unset: unset
  };
}

// GET /api/nodes คืน snapshot ล่าสุดของทุกโหนดพร้อมสถานะ online
router.get('/', async (req, res, next) => {
  try {
    const nodes = await NodeModel.find().sort({ node_id: 1 });
    return res.json(buildNodeStatusList(nodes));
  } catch (error) {
    return next(error);
  }
});

// GET /api/nodes/:node_id คืนข้อมูลล่าสุดของโหนดที่ระบุ
router.get('/:node_id', async (req, res, next) => {
  try {
    const node = await NodeModel.findOne({ node_id: req.params.node_id });
    if (!node) {
      return res.status(404).json({ error: 'node not found' });
    }

    return res.json(withOnlineStatus(node));
  } catch (error) {
    return next(error);
  }
});

// POST /api/nodes/:node_id/gps/reacquire สร้างคำสั่งให้โหนดค้นหา GPS ใหม่
router.post('/:node_id/gps/reacquire', requireLocalAdmin, async (req, res, next) => {
  try {
    const node = await NodeModel.findOne({ node_id: req.params.node_id });
    if (!node) {
      return res.status(404).json({ error: 'node not found' });
    }

    const { command, duplicate } = await enqueueLatestGpsCommand(node.node_id, 'gps_reacquire');
    await NodeModel.updateOne(
      { _id: node._id }, buildGpsReacquireUpdate(node)
    );

    return res.status(202).json({ ...command, duplicate });
  } catch (error) {
    return next(error);
  }
});

// POST /api/nodes/:node_id/location/manual บันทึกพิกัดที่ Admin กรอกเอง
router.post('/:node_id/location/manual', requireLocalAdmin, async (req, res, next) => {
  try {
    if (typeof req.body?.lat !== 'number' || typeof req.body?.lng !== 'number') {
      return res.status(400).json({ error: 'invalid coordinates' });
    }

    const latitude = req.body.lat;
    const longitude = req.body.lng;
    if (!isValidCoordinate(latitude, longitude)) {
      return res.status(400).json({ error: 'invalid coordinates' });
    }

    const node = await NodeModel.findOneAndUpdate(
      { node_id: req.params.node_id },
      {
        $set: {
          lat: latitude,
          lng: longitude,
          gps_fixed: false,
          location_source: 'manual',
          location_updated_at: new Date()
        },
        $unset: { gps_error: '' }
      },
      { new: true }
    );

    if (!node) {
      return res.status(404).json({ error: 'node not found' });
    }

    // พิกัดที่ Admin กรอกมีสิทธิ์สูงกว่า จึงสั่งโหนดหยุดค้นหา GPS ในรอบสื่อสารถัดไป
    await enqueueLatestGpsCommand(node.node_id, 'gps_manual');

    return res.json(withOnlineStatus(node));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.buildGpsReacquireUpdate = buildGpsReacquireUpdate;
module.exports.buildNodeStatusList = buildNodeStatusList;
module.exports.offlineTimeoutMs = offlineTimeoutMs;
module.exports.withOnlineStatus = withOnlineStatus;
