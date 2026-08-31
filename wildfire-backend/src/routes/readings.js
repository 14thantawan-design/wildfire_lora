const express = require('express');
const mongoose = require('mongoose');
const Reading = require('../models/Reading');
const { requireLocalAdmin } = require('../middleware/security');

const router = express.Router();

function parseLimit(value, fallback = 100) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 5000);
}

function parseDate(value) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parsePage(value) {
  const parsed = Number(value || 1);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.floor(parsed);
}

function parseBucketMs(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 10000 || parsed > 7 * 24 * 60 * 60 * 1000) {
    return undefined;
  }
  return Math.floor(parsed);
}

function serializeReading(reading) {
  const obj = reading.toObject ? reading.toObject() : { ...reading };
  const rawPacket = obj.raw_packet || {};
  const serverState = obj.server_state || obj.state || 'NORMAL';

  obj.node_state = obj.node_state || rawPacket.st || obj.state || 'UNKNOWN';
  obj.node_confidence = obj.node_confidence ?? rawPacket.c ?? obj.confidence ?? 0;
  obj.server_state = serverState;
  obj.server_risk_score = obj.server_risk_score ?? 0;
  obj.server_reasons = obj.server_reasons || [];
  obj.fire_danger_level = obj.fire_danger_level || 'LOW';
  obj.evidence = obj.evidence || {
    smoke: 'none',
    heat: 'none',
    humidity: 'none',
    trend: 'none'
  };
  obj.state = serverState;

  return obj;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function editableNumber(value, field, minimum, maximum) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw validationError(`${field} is out of range`);
  }
  return value;
}

function buildReadingUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('reading update must be an object');
  }

  const set = {};
  const rawFieldNames = {
    air_temp: 'at',
    humidity: 'h',
    smoke_raw: 'sm',
    sensor_health: 'sh'
  };
  const numericFields = {
    air_temp: [-80, 100],
    humidity: [0, 100],
    smoke_raw: [0, 4095],
    rssi: [-200, 50],
    snr: [-50, 50]
  };

  for (const [field, [minimum, maximum]] of Object.entries(numericFields)) {
    if (!Object.hasOwn(input, field)) continue;
    const value = editableNumber(input[field], field, minimum, maximum);
    set[field] = value;
    if (rawFieldNames[field]) set[`raw_packet.${rawFieldNames[field]}`] = value;
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
      set['raw_packet.sh'] = null;
    } else {
      const sensorHealth = typeof input.sensor_health === 'string'
        ? input.sensor_health.trim().toUpperCase()
        : '';
      if (!['OK', 'CAL', 'CALIBRATING', 'FAULT'].includes(sensorHealth)) {
        throw validationError('sensor_health is invalid');
      }
      set.sensor_health = sensorHealth;
      set['raw_packet.sh'] = sensorHealth;
    }
  }

  if (Object.keys(set).length === 0) {
    throw validationError('no editable reading fields were provided');
  }

  return { $set: set };
}

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

function normalizeNodeId(value) {
  const nodeId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(nodeId)) {
    throw validationError('node_id is invalid');
  }
  return nodeId;
}

router.get('/admin', requireLocalAdmin, async (req, res, next) => {
  try {
    const page = parsePage(req.query.page);
    const limit = Math.min(parseLimit(req.query.limit, 50), 200);
    const nodeId = typeof req.query.node_id === 'string' ? req.query.node_id.trim() : '';
    const query = nodeId ? { node_id: nodeId } : {};
    const [readings, total, nodeIds] = await Promise.all([
      Reading.find(query)
        .select('-raw_packet -packet_hash')
        .sort({ timestamp: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
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

router.patch('/admin/:id', requireLocalAdmin, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'invalid reading id' });
    }

    const reading = await Reading.findByIdAndUpdate(
      req.params.id,
      buildReadingUpdate(req.body),
      { new: true, runValidators: true }
    ).select('-raw_packet -packet_hash');

    if (!reading) return res.status(404).json({ error: 'reading not found' });
    return res.json(serializeReading(reading));
  } catch (error) {
    return next(error);
  }
});

router.delete('/admin', requireLocalAdmin, async (req, res, next) => {
  try {
    const ids = normalizeReadingIds(req.body?.ids);
    const result = await Reading.deleteMany({ _id: { $in: ids } });
    return res.json({ requested: ids.length, deleted: result.deletedCount });
  } catch (error) {
    return next(error);
  }
});

router.delete('/admin/node/:node_id', requireLocalAdmin, async (req, res, next) => {
  try {
    const nodeId = normalizeNodeId(req.params.node_id);
    const result = await Reading.deleteMany({ node_id: nodeId });
    return res.json({ node_id: nodeId, deleted: result.deletedCount });
  } catch (error) {
    return next(error);
  }
});

router.get('/latest', async (req, res, next) => {
  try {
    const latest = await Reading.aggregate([
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$node_id', reading: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$reading' } },
      { $sort: { node_id: 1 } }
    ]);

    res.json(latest.map(serializeReading));
  } catch (error) {
    next(error);
  }
});

router.get('/:node_id', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 100);
    const from = parseDate(req.query.from);
    const bucketMs = parseBucketMs(req.query.bucket_ms);
    const query = { node_id: req.params.node_id };

    if (from) {
      query.timestamp = { $gte: from };
    }

    if (bucketMs) {
      const readings = await Reading.aggregate([
        { $match: query },
        { $sort: { timestamp: 1 } },
        {
          $group: {
            _id: {
              $subtract: [
                { $toLong: '$timestamp' },
                { $mod: [{ $toLong: '$timestamp' }, bucketMs] }
              ]
            },
            node_id: { $last: '$node_id' },
            seq: { $last: '$seq' },
            timestamp: { $last: '$timestamp' },
            state: { $last: '$state' },
            confidence: { $last: '$confidence' },
            node_state: { $last: '$node_state' },
            node_confidence: { $last: '$node_confidence' },
            server_state: { $last: '$server_state' },
            server_risk_score: { $max: '$server_risk_score' },
            server_reasons: { $last: '$server_reasons' },
            fire_danger_level: { $last: '$fire_danger_level' },
            evidence: { $last: '$evidence' },
            air_temp: { $avg: '$air_temp' },
            humidity: { $avg: '$humidity' },
            smoke_raw: { $avg: '$smoke_raw' },
            sensor_health: { $last: '$sensor_health' },
            rssi: { $last: '$rssi' },
            snr: { $last: '$snr' }
          }
        },
        { $sort: { timestamp: -1 } },
        { $limit: limit }
      ]);

      return res.json(readings.map(serializeReading));
    }

    const readings = await Reading.find(query).sort({ timestamp: -1 }).limit(limit);

    return res.json(readings.map(serializeReading));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.buildReadingUpdate = buildReadingUpdate;
module.exports.normalizeNodeId = normalizeNodeId;
module.exports.normalizeReadingIds = normalizeReadingIds;
module.exports.serializeReading = serializeReading;
