const express = require('express');
const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const { normalizeNodeRisk } = require('../services/nodeRisk');
const { requireLocalAdmin } = require('../middleware/security');

const router = express.Router();

function serializeAlert(alert) {
  const obj = alert.toObject ? alert.toObject() : { ...alert };
  if (obj.level === 'CRITICAL') obj.level = 'WARNING';
  if (obj.max_state === 'CRITICAL') obj.max_state = 'WARNING';
  if (obj.telegram_notified_level === 'CRITICAL') obj.telegram_notified_level = 'WARNING';
  if (obj.last_reading) {
    obj.last_reading = normalizeNodeRisk(obj.last_reading);
    if (obj.last_reading.risk_model_version >= 7) {
      delete obj.max_confidence;
      delete obj.max_risk_score;
    }
  }
  return obj;
}

function parseLimit(value, fallback = 100) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 1000);
}

router.get('/active', async (req, res, next) => {
  try {
    const alerts = await Alert.find({ active: true }).sort({ started_at: -1 });
    res.json(alerts.map(serializeAlert));
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
    res.json(alerts.map(serializeAlert));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', requireLocalAdmin, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'invalid alert id' });
    }

    const alert = await Alert.findByIdAndDelete(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'alert not found' });
    }

    return res.json({ deleted: true, alert_id: req.params.id });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.serializeAlert = serializeAlert;
