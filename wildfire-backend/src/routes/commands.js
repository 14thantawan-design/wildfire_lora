const express = require('express');
const { acknowledgeCommand, listPendingCommands } = require('../services/commandQueue');

const router = express.Router();

router.get('/pending', (req, res) => {
  res.json(listPendingCommands());
});

router.post('/:command_id/ack', (req, res) => {
  const acknowledged = acknowledgeCommand(req.params.command_id);
  res.json({ acknowledged });
});

module.exports = router;
