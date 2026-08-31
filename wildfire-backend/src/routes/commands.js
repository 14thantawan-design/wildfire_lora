const express = require('express');
const {
  completeCommand,
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
    const accepted = req.body?.accepted !== false;
    const command = accepted
      ? await completeCommand(req.params.command_id, true)
      : await completeCommand(req.params.command_id, false, req.body?.reason);
    return res.json({
      acknowledged: Boolean(command),
      accepted,
      command
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
