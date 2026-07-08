const express = require('express');
const Reading = require('../models/Reading');

const router = express.Router();

function parseLimit(value, fallback = 100) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 1000);
}

router.get('/latest', async (req, res, next) => {
  try {
    const latest = await Reading.aggregate([
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$node_id', reading: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$reading' } },
      { $sort: { node_id: 1 } }
    ]);

    res.json(latest);
  } catch (error) {
    next(error);
  }
});

router.get('/:node_id', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 100);
    const readings = await Reading.find({ node_id: req.params.node_id })
      .sort({ timestamp: -1 })
      .limit(limit);

    res.json(readings);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
