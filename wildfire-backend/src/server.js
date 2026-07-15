require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./db');
const nodesRouter = require('./routes/nodes');
const readingsRouter = require('./routes/readings');
const alertsRouter = require('./routes/alerts');
const commandsRouter = require('./routes/commands');
const { handlePacket } = require('./services/packetHandler');
const { createSerialBridge } = require('./serialBridge');
const { corsOptions, requireGatewayKey } = require('./middleware/security');
const { gatewayStatus, markGatewayPacket } = require('./services/gatewayStatus');

const app = express();
const port = Number(process.env.PORT || 4000);
let serialBridge = null;
let httpServer = null;

app.use(cors(corsOptions()));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    service: 'wildfire-backend',
    api_version: 2,
    ok: mongoReady,
    uptime_sec: Math.round(process.uptime()),
    mongo_state: mongoose.connection.readyState,
    serial_enabled: Boolean(process.env.SERIAL_PORT),
    serial: serialBridge ? serialBridge.status() : { enabled: false },
    gateway: gatewayStatus()
  });
});

app.use('/api/nodes', nodesRouter);
app.use('/api/readings', readingsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/commands', commandsRouter);

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

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((error, req, res, next) => {
  console.error(`api error: ${error.message}`);
  res.status(error.status || 500).json({
    error: error.status && error.status < 500 ? error.message : 'internal server error'
  });
});

async function start() {
  try {
    await connectDB();

    await new Promise((resolve, reject) => {
      httpServer = app.listen(port, resolve);
      httpServer.once('error', reject);
    });
    console.log(`API running: http://localhost:${port}`);

    serialBridge = createSerialBridge();
    serialBridge.start();
  } catch (error) {
    console.error(`startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  if (serialBridge) serialBridge.close();
  if (httpServer) httpServer.close();
  mongoose.connection.close(false).finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
