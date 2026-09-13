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

function normalizeTeamDomain(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';

  try {
    const url = new URL(rawValue.includes('://') ? rawValue : `https://${rawValue}`);
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.cloudflareaccess.com') ||
      url.username ||
      url.password ||
      (url.pathname && url.pathname !== '/') ||
      url.search ||
      url.hash
    ) {
      return '';
    }
    return url.origin;
  } catch {
    return '';
  }
}

function adminConfigFromEnvironment(environment = process.env) {
  return {
    hostname: String(environment.ADMIN_HOSTNAME || 'admin.nattaphat.me').trim().toLowerCase(),
    teamDomain: normalizeTeamDomain(environment.CF_ACCESS_TEAM_DOMAIN),
    audience: String(environment.CF_ACCESS_AUD || '').trim()
  };
}

const accessVerifierCache = new Map();

async function cloudflareAccessVerifier(config) {
  const cacheKey = `${config.teamDomain}|${config.audience}`;
  if (!accessVerifierCache.has(cacheKey)) {
    accessVerifierCache.set(cacheKey, import('jose').then(({ createRemoteJWKSet, jwtVerify }) => {
      const certsUrl = new URL('/cdn-cgi/access/certs', `${config.teamDomain}/`);
      const keySet = createRemoteJWKSet(certsUrl, { timeoutDuration: 5000 });
      return async (token) => {
        const result = await jwtVerify(token, keySet, {
          algorithms: ['RS256'],
          issuer: config.teamDomain,
          audience: config.audience
        });
        return result.payload;
      };
    }));
  }

  return accessVerifierCache.get(cacheKey);
}

async function verifyCloudflareAccessToken(token, config) {
  const verify = await cloudflareAccessVerifier(config);
  return verify(token);
}

async function isTrustedAdminRequest(
  req,
  config = adminConfigFromEnvironment(),
  verifyToken = verifyCloudflareAccessToken
) {
  const fromCloudflare = Boolean(req.get('cf-connecting-ip'));
  if (isLoopbackAddress(req.socket?.remoteAddress) && !fromCloudflare) {
    return true;
  }

  const accessToken = req.get('cf-access-jwt-assertion');
  const hasRequiredRequestContext = Boolean(
    fromCloudflare &&
    isLoopbackAddress(req.socket?.remoteAddress) &&
    accessToken &&
    config.hostname &&
    requestHostname(req) === config.hostname &&
    config.teamDomain &&
    config.audience
  );
  if (!hasRequiredRequestContext) return false;

  try {
    req.accessIdentity = await verifyToken(accessToken, config);
    return Boolean(req.accessIdentity);
  } catch {
    return false;
  }
}

function requireLocalAdmin(req, res, next) {
  isTrustedAdminRequest(req)
    .then((trusted) => {
      if (trusted) return next();
      return res.status(403).json({
        error: 'admin authentication is required for this action'
      });
    })
    .catch(next);
}

function corsOptions() {
  const configured = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowed = new Set([
    ...configured,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4000',
    'http://127.0.0.1:4000'
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
  adminConfigFromEnvironment,
  corsOptions,
  isTrustedAdminRequest,
  normalizeTeamDomain,
  requestHostname,
  requireGatewayKey,
  requireLocalAdmin,
  verifyCloudflareAccessToken
};
