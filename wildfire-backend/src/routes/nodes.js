const express = require('express');
const NodeModel = require('../models/Node');
const { enqueueCommand } = require('../services/commandQueue');
const { batteryPercentFromVoltage } = require('../services/battery');
const { requireLocalAdmin } = require('../middleware/security');

const router = express.Router();

function offlineTimeoutMs(node) {
  const configuredMinimum = Number(process.env.OFFLINE_TIMEOUT_MS || 60000);
  const expectedIntervalMs = Number(node?.report_interval_sec || 0) * 1000;
  return Math.max(configuredMinimum, expectedIntervalMs * 1.5 + 30000);
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
  if (typeof obj.battery_v === 'number' && Number.isFinite(obj.battery_v)) {
    obj.battery_percent = typeof obj.battery_percent === 'number' &&
      Number.isFinite(obj.battery_percent)
      ? Math.max(0, Math.min(100, Math.round(obj.battery_percent)))
      : batteryPercentFromVoltage(obj.battery_v);
  }
  if (!obj.location_source && obj.gps_fixed && obj.lat !== undefined && obj.lng !== undefined) {
    obj.location_source = 'gps';
  }
  return obj;
}

function isValidCoordinate(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return Math.abs(latitude) >= 0.000001 || Math.abs(longitude) >= 0.000001;
}

function buildGpsReacquireUpdate(node) {
  const unset = {
    gps_satellites: '',
    gps_hdop: ''
  };

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

router.get('/', async (req, res, next) => {
  try {
    const nodes = await NodeModel.find().sort({ node_id: 1 });
    res.json(nodes.map(withOnlineStatus));
  } catch (error) {
    next(error);
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

router.post('/:node_id/gps/reacquire', requireLocalAdmin, async (req, res, next) => {
  try {
    const node = await NodeModel.findOne({ node_id: req.params.node_id });
    if (!node) {
      return res.status(404).json({ error: 'node not found' });
    }

    const { command, duplicate } = await enqueueCommand(node.node_id, 'gps_reacquire');
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

    return res.json(withOnlineStatus(node));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.buildGpsReacquireUpdate = buildGpsReacquireUpdate;
module.exports.withOnlineStatus = withOnlineStatus;
