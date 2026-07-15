const express = require('express');
const {
  acknowledgeCommand,
  listPendingCommands,
  markCommandSent
} = require('../services/commandQueue');
const { requireGatewayKey } = require('../middleware/security');
const { markGatewayPacket } = require('../services/gatewayStatus');

const router = express.Router();

router.use(requireGatewayKey);

router.get('/pending', async (req, res, next) => {
  try {
    markGatewayPacket('http');
    res.json(await listPendingCommands());
  } catch (error) {
    next(error);
  }
});

router.post('/:command_id/sent', async (req, res, next) => {
  try {
    markGatewayPacket('http');
    const command = await markCommandSent(req.params.command_id);
    return res.json({ marked: Boolean(command), command });
  } catch (error) {
    return next(error);
  }
});

router.post('/:command_id/ack', async (req, res, next) => {
  try {
    markGatewayPacket('http');
    const acknowledged = await acknowledgeCommand(req.params.command_id);
    return res.json({ acknowledged });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
