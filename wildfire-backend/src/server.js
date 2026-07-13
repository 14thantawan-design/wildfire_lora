require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./db');
const nodesRouter = require('./routes/nodes');
const readingsRouter = require('./routes/readings');
const alertsRouter = require('./routes/alerts');
const { handlePacket } = require('./services/packetHandler');
const { createSerialBridge } = require('./serialBridge');

const app = express();
const port = Number(process.env.PORT || 4000);
let serialBridge = null;

app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime_sec: Math.round(process.uptime()),
    mongo_state: mongoose.connection.readyState,
    serial_enabled: Boolean(process.env.SERIAL_PORT),
    serial: serialBridge ? serialBridge.status() : { enabled: false }
  });
});

app.use('/api/nodes', nodesRouter);
app.use('/api/readings', readingsRouter);
app.use('/api/alerts', alertsRouter);

app.post('/api/packets', async (req, res, next) => {
  try {
    const result = await handlePacket(req.body);
    if (result.ignored) {
      return res.status(202).json(result);
    }

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
  res.status(500).json({ error: 'internal server error' });
});

async function start() {
  try {
    await connectDB();

    app.listen(port, () => {
      console.log(`API running: http://localhost:${port}`);
    });

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
  mongoose.connection.close(false).finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
