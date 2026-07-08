const express = require('express');
const Alert = require('../models/Alert');

const router = express.Router();

function parseLimit(value, fallback = 100) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 1000);
}

router.get('/active', async (req, res, next) => {
  try {
    const alerts = await Alert.find({ active: true }).sort({ started_at: -1 });
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 100);
    const query = {};
    if (req.query.active === 'true') query.active = true;
    if (req.query.active === 'false') query.active = false;

    const alerts = await Alert.find(query).sort({ started_at: -1 }).limit(limit);
    res.json(alerts);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
