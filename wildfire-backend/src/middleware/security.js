const crypto = require('crypto');

function safeEqual(provided, expected) {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(String(provided));
  const expectedBuffer = Buffer.from(String(expected));
  return providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function requireGatewayKey(req, res, next) {
  const expected = process.env.GATEWAY_API_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'gateway authentication is not configured' });
  }

  if (!safeEqual(req.get('x-gateway-key'), expected)) {
    return res.status(401).json({ error: 'invalid gateway key' });
  }

  return next();
}

function isLoopback(address = '') {
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

function requireLocalAdmin(req, res, next) {
  if (isLoopback(req.socket?.remoteAddress)) return next();

  const expected = process.env.ADMIN_API_KEY;
  if (expected && safeEqual(req.get('x-admin-key'), expected)) return next();
  return res.status(403).json({ error: 'admin action is only available from the backend computer' });
}

function corsOptions() {
  const configured = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowed = new Set(configured.length ? configured : [
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ]);

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      const error = new Error('origin is not allowed');
      error.status = 403;
      return callback(error);
    }
  };
}

module.exports = {
  corsOptions,
  requireGatewayKey,
  requireLocalAdmin
};
