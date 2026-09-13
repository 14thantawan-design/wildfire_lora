const express = require('express');
const NodeModel = require('../models/Node');
const {
  enqueueCommand,
  enqueueLatestGpsCommand,
  getLatestCommandForNode,
  isBaselineCalibrationInProgress
} = require('../services/commandQueue');
const { requireLocalAdmin } = require('../middleware/security');

const router = express.Router();

function offlineTimeoutMs(node) {
  const configuredMinimum = Number(process.env.OFFLINE_TIMEOUT_MS || 60000);
  const configuredMultiplier = Number(process.env.OFFLINE_INTERVAL_MULTIPLIER || 2.5);
  const configuredJitter = Number(process.env.OFFLINE_JITTER_GRACE_MS || 30000);
  const intervalMultiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier >= 1
    ? configuredMultiplier
    : 2.5;
  const jitterGraceMs = Number.isFinite(configuredJitter) && configuredJitter >= 0
    ? configuredJitter
    : 30000;
  const expectedIntervalMs = Number(node?.report_interval_sec || 0) * 1000;
  return Math.max(configuredMinimum, expectedIntervalMs * intervalMultiplier + jitterGraceMs);
}

function withOnlineStatus(node) {
  const obj = node.toObject ? node.toObject() : { ...node };
  const lastSeen = obj.last_seen ? new Date(obj.last_seen).getTime() : 0;
  obj.online = lastSeen > 0 && Date.now() - lastSeen <= offlineTimeoutMs(obj);
  obj.node_state = obj.node_state || obj.state || 'UNKNOWN';
  obj.node_confidence = obj.node_confidence ?? obj.confidence ?? 0;
  obj.server_state = obj.online ? obj.server_state || obj.state || 'NORMAL' : 'OFFLINE';
  obj.server_risk_score = obj.server_risk_score ?? 0;
  obj.server_reasons = obj.server_reasons || [];
  obj.fire_danger_level = obj.fire_danger_level || 'LOW';
  if (!obj.location_source && obj.gps_fixed && obj.lat !== undefined && obj.lng !== undefined) {
    obj.location_source = 'gps';
  }
  return obj;
}

function buildNodeStatusList(nodes) {
  return nodes.map(withOnlineStatus);
}

function isValidCoordinate(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return Math.abs(latitude) >= 0.000001 || Math.abs(longitude) >= 0.000001;
}

function buildGpsReacquireUpdate(node) {
  const unset = {};

  // A manually entered location remains a fallback while the node searches.
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

function baselineRecalibrationBlock(node) {
  const liveNode = withOnlineStatus(node);
  if (!liveNode.online) {
    return { code: 'node_offline', message: 'Node ออฟไลน์อยู่ จึงยังสั่งเรียน baseline ใหม่ไม่ได้' };
  }

  const nodeState = String(liveNode.node_state || '').toUpperCase();
  const serverState = String(liveNode.server_state || liveNode.state || '').toUpperCase();
  if (isBaselineCalibrationInProgress(liveNode) || serverState === 'CALIBRATING') {
    return { code: 'already_calibrating', message: 'Node กำลังเรียน baseline อยู่แล้ว' };
  }
  const serverUnsafe = ['WARNING', 'CRITICAL', 'SENSOR_FAULT'].includes(serverState);
  const nodeUnsafe = ['CRITICAL', 'SENSOR_FAULT'].includes(nodeState);
  if (serverUnsafe || nodeUnsafe) {
    return { code: 'unsafe_state', message: 'สถานะของ Node ยังไม่ปลอดภัยสำหรับการเรียน baseline ใหม่' };
  }
  if (String(liveNode.sensor_health || '').toUpperCase() !== 'OK') {
    return { code: 'sensor_not_ready', message: 'เซนเซอร์ยังไม่พร้อม จึงไม่สามารถเรียน baseline ใหม่ได้' };
  }
  if (Number(liveNode.smoke_raw) >= 1200 ||
      Number(liveNode.air_temp) >= 40 ||
      Number(liveNode.humidity) <= 35) {
    return { code: 'unsafe_reading', message: 'ค่าปัจจุบันผิดปกติ กรุณารอให้อากาศกลับสู่สภาพปลอดภัยก่อน' };
  }
  return null;
}

function buildBaselineRecalibrationSnapshot(node, command) {
  const liveNode = withOnlineStatus(node);
  const baselineInProgress = isBaselineCalibrationInProgress(liveNode);
  let phase = 'idle';

  if (baselineInProgress) phase = 'calibrating';
  else if (command?.completed_at && ['sent', 'acknowledged'].includes(command.status)) phase = 'completed';
  else if (command?.status === 'pending') phase = 'pending';
  else if (command?.status === 'sent') phase = 'sent';
  else if (command?.status === 'rejected') phase = 'rejected';
  else if (command?.status === 'acknowledged') {
    if (command.completed_at) {
      phase = 'completed';
    } else if (command.baseline_started_at) {
      phase = 'calibrating';
    } else {
      phase = 'accepted';
    }
  }

  return {
    phase,
    command: command || null,
    node_id: liveNode.node_id,
    node_state: liveNode.node_state,
    online: liveNode.online,
    baseline_warmup_count: liveNode.baseline_warmup_count ?? null,
    baseline_warmup_target: liveNode.baseline_warmup_target ?? null
  };
}

router.get('/', async (req, res, next) => {
  try {
    const nodes = await NodeModel.find().sort({ node_id: 1 });
    return res.json(buildNodeStatusList(nodes));
  } catch (error) {
    return next(error);
  }
});

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

router.get('/:node_id/baseline/recalibration', requireLocalAdmin, async (req, res, next) => {
  try {
    const node = await NodeModel.findOne({ node_id: req.params.node_id });
    if (!node) {
      return res.status(404).json({ error: 'node not found' });
    }
    const command = await getLatestCommandForNode(node.node_id, 'baseline_recalibrate');
    return res.json(buildBaselineRecalibrationSnapshot(node, command));
  } catch (error) {
    return next(error);
  }
});

router.post('/:node_id/baseline/recalibration', requireLocalAdmin, async (req, res, next) => {
  try {
    const node = await NodeModel.findOne({ node_id: req.params.node_id });
    if (!node) {
      return res.status(404).json({ error: 'node not found' });
    }

    const block = baselineRecalibrationBlock(node);
    if (block) {
      return res.status(409).json({ error: block.code, message: block.message });
    }

    const { command, duplicate } = await enqueueCommand(node.node_id, 'baseline_recalibrate');
    return res.status(202).json({
      ...buildBaselineRecalibrationSnapshot(node, command),
      duplicate
    });
  } catch (error) {
    return next(error);
  }
});

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

    // Manual coordinates are authoritative. Tell the physical Node to stop its
    // automatic GPS search as soon as its next uplink opens a command window.
    await enqueueLatestGpsCommand(node.node_id, 'gps_manual');

    return res.json(withOnlineStatus(node));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.buildGpsReacquireUpdate = buildGpsReacquireUpdate;
module.exports.baselineRecalibrationBlock = baselineRecalibrationBlock;
module.exports.buildBaselineRecalibrationSnapshot = buildBaselineRecalibrationSnapshot;
module.exports.buildNodeStatusList = buildNodeStatusList;
module.exports.offlineTimeoutMs = offlineTimeoutMs;
module.exports.withOnlineStatus = withOnlineStatus;
