// จุดเริ่มต้นของ Backend: โหลดค่าตั้งต้น ประกอบ Express routes และเปิด HTTP server
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./db');
const nodesRouter = require('./routes/nodes');
const readingsRouter = require('./routes/readings');
const alertsRouter = require('./routes/alerts');
const commandsRouter = require('./routes/commands');
const { handlePacket } = require('./services/packetHandler');
const { corsOptions, requireGatewayKey } = require('./middleware/security');
const { gatewayStatus, markGatewayPacket } = require('./services/gatewayStatus');
const { isTelegramConfigured } = require('./services/telegramService');

const app = express();
const dashboardDirectory = path.resolve(__dirname, '../../wildfire-dashboard/dist');
const dashboardIndex = path.join(dashboardDirectory, 'index.html');
const dashboardAvailable = fs.existsSync(dashboardIndex);
const port = Number(process.env.PORT || 4000);
let httpServer = null;

// เปิด CORS และแปลง request body รูปแบบ JSON โดยจำกัดขนาดข้อมูล
app.use(cors(corsOptions()));
app.use(express.json({ limit: '256kb' }));

// GET /api/health สรุปสถานะ Backend, MongoDB, Gateway และ Telegram
app.get('/api/health', (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    service: 'wildfire-backend',
    api_version: 2,
    ok: mongoReady,
    dashboard_served: dashboardAvailable,
    uptime_sec: Math.round(process.uptime()),
    mongo_state: mongoose.connection.readyState,
    telegram_configured: isTelegramConfigured(),
    gateway: gatewayStatus()
  });
});

// เชื่อมกลุ่ม URL หลักเข้ากับ Router ที่รับผิดชอบแต่ละข้อมูล
app.use('/api/nodes', nodesRouter);
app.use('/api/readings', readingsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/commands', commandsRouter);

// POST /api/packets รับแพ็กเก็ตจาก Gateway แล้วส่งไปยัง handler ตามชนิดข้อมูล
app.post('/api/packets', requireGatewayKey, async (req, res, next) => {
  try {
    const result = await handlePacket(req.body);
    if (result.ignored) {
      return res.status(result.invalid ? 400 : 202).json(result);
    }

    markGatewayPacket('http');
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

// ตอบ 404 สำหรับ URL ใต้ /api ที่ไม่มีอยู่
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not found' });
});

// ให้ Express เสิร์ฟไฟล์ Dashboard ที่ build แล้วเมื่อพบโฟลเดอร์ dist
if (dashboardAvailable) {
  app.use(express.static(dashboardDirectory, {
    dotfiles: 'ignore',
    index: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
  }));
  app.get('*', (req, res) => res.sendFile(dashboardIndex));
}

// แจ้งให้รู้ว่าเครื่องนี้ยังไม่มี Dashboard build สำหรับ URL ที่เหลือ
app.use((req, res) => {
  res.status(404).json({ error: 'dashboard build not found' });
});

// Error middleware กลาง แปลงข้อผิดพลาดเป็น JSON โดยไม่เปิดเผยรายละเอียดภายใน
app.use((error, req, res, next) => {
  console.error(`api error: ${error.message}`);
  res.status(error.status || 500).json({
    error: error.status && error.status < 500 ? error.message : 'internal server error'
  });
});

// เชื่อม MongoDB ให้สำเร็จก่อนเปิดรับ HTTP request
async function start() {
  try {
    await connectDB();

    await new Promise((resolve, reject) => {
      httpServer = app.listen(port, resolve);
      httpServer.once('error', reject);
    });
    console.log(`API running: http://localhost:${port}`);
  } catch (error) {
    console.error(`startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

// ปิด server และฐานข้อมูลอย่างเป็นระเบียบเมื่อ container ถูกหยุด
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  if (httpServer) httpServer.close();
  mongoose.connection.close(false).finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
