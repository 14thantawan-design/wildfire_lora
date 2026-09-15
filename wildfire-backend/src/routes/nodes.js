const express = require('express');
const NodeModel = require('../models/Node');
const { normalizeNodeRisk } = require('../services/nodeRisk');
const {
  enqueueLatestGpsCommand
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
  const obj = normalizeNodeRisk(node);
  const lastSeen = obj.last_seen ? new Date(obj.last_seen).getTime() : 0;
  obj.online = lastSeen > 0 && Date.now() - lastSeen <= offlineTimeoutMs(obj);
  obj.node_state = obj.node_state || obj.state || 'UNKNOWN';
  // Connectivity is independent of the last risk decision made by the node.
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
module.exports.buildNodeStatusList = buildNodeStatusList;
module.exports.offlineTimeoutMs = offlineTimeoutMs;
module.exports.withOnlineStatus = withOnlineStatus;
