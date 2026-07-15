const express = require('express');
const Reading = require('../models/Reading');

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
