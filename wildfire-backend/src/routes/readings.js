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
    const query = { node_id: req.params.node_id };

    if (from) {
      query.timestamp = { $gte: from };
    }

    const readings = await Reading.find(query)
      .sort({ timestamp: -1 })
      .limit(limit);

    res.json(readings.map(serializeReading));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
