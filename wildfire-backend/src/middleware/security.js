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

function isLoopbackAddress(address = '') {
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

function requestHostname(req) {
  const forwardedHost = firstHeaderValue(req.get('x-forwarded-host'));
  const host = forwardedHost || firstHeaderValue(req.get('host'));
  return host.replace(/:\d+$/, '').toLowerCase();
}

function adminConfigFromEnvironment() {
  return {
    hostname: String(process.env.ADMIN_HOSTNAME || 'admin.nattaphat.me').trim().toLowerCase(),
    emails: new Set(
      String(process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    )
  };
}

function isTrustedAdminRequest(req, config = adminConfigFromEnvironment()) {
  const fromCloudflare = Boolean(req.get('cf-connecting-ip'));
  if (isLoopbackAddress(req.socket?.remoteAddress) && !fromCloudflare) {
    return true;
  }

  const accessToken = req.get('cf-access-jwt-assertion');
  const accessEmail = String(req.get('cf-access-authenticated-user-email') || '')
    .trim()
    .toLowerCase();

  return Boolean(
    fromCloudflare &&
    isLoopbackAddress(req.socket?.remoteAddress) &&
    accessToken &&
    config.hostname &&
    requestHostname(req) === config.hostname &&
    config.emails.size > 0 &&
    config.emails.has(accessEmail)
  );
}

function requireLocalAdmin(req, res, next) {
  if (isTrustedAdminRequest(req)) return next();

  const expected = process.env.ADMIN_API_KEY;
  if (expected && safeEqual(req.get('x-admin-key'), expected)) return next();
  return res.status(403).json({
    error: 'admin authentication is required for this action'
  });
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
  isTrustedAdminRequest,
  requestHostname,
  requireGatewayKey,
  requireLocalAdmin
};
