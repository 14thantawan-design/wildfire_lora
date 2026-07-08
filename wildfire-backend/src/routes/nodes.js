const express = require('express');
const NodeModel = require('../models/Node');

const router = express.Router();

function offlineTimeoutMs() {
  return Number(process.env.OFFLINE_TIMEOUT_MS || 60000);
}

function withOnlineStatus(node) {
  const obj = node.toObject ? node.toObject() : { ...node };
  const lastSeen = obj.last_seen ? new Date(obj.last_seen).getTime() : 0;
  obj.online = lastSeen > 0 && Date.now() - lastSeen <= offlineTimeoutMs();
  return obj;
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

module.exports = router;
