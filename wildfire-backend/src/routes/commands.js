// API ระหว่าง Gateway กับคิวคำสั่ง GPS ใน Backend
const express = require('express');
const {
  listPendingCommands,
  markCommandSent
} = require('../services/commandQueue');
const { requireGatewayKey } = require('../middleware/security');
const { markGatewayPacket } = require('../services/gatewayStatus');

const router = express.Router();

// ทุก endpoint ในไฟล์นี้ต้องยืนยันตัวตนด้วย Gateway API key
router.use(requireGatewayKey);

// GET /api/commands/pending คืนคำสั่งที่ยังรอ Gateway นำไปส่งให้โหนด
router.get('/pending', async (req, res, next) => {
  try {
    markGatewayPacket('http');
    res.json(await listPendingCommands());
  } catch (error) {
    next(error);
  }
});

// POST /api/commands/:command_id/sent บันทึกว่า Gateway ส่งคำสั่งแล้ว
router.post('/:command_id/sent', async (req, res, next) => {
  try {
    markGatewayPacket('http');
    const command = await markCommandSent(req.params.command_id);
    return res.json({ marked: Boolean(command), command });
  } catch (error) {
    return next(error);
  }
});

// Legacy ACK cannot prove which node sent it. Only /api/packets accepts signed ACK.
router.post('/:command_id/ack', (req, res) => {
  res.status(401).json({ error: 'authenticated node ACK must be forwarded through /api/packets' });
});

module.exports = router;
