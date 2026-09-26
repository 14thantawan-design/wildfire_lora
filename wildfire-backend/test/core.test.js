const test = require('node:test');
const assert = require('node:assert/strict');

const {
  severityOf,
  shouldNotifyLevel
} = require('../src/services/alertService');
const {
  adminConfigFromEnvironment,
  corsOptions,
  isTrustedAdminRequest,
  normalizeTeamDomain
} = require('../src/middleware/security');
const CommandModel = require('../src/models/Command');
const { oppositeGpsCommand } = require('../src/services/commandQueue');
const {
  buildGpsReacquireUpdate,
  buildNodeStatusList,
  offlineTimeoutMs
} = require('../src/routes/nodes');
const {
  buildReadingUpdate,
  normalizeNodeId,
  normalizeReadingIds
} = require('../src/routes/readings');
const {
  buildTelegramMessage,
  escapeHtml,
  isTelegramConfigured
} = require('../src/services/telegramService');

test('GPS reacquire preserves a manual fallback but clears a stale GPS fix', () => {
  const manualUpdate = buildGpsReacquireUpdate({ location_source: 'manual' });
  const gpsUpdate = buildGpsReacquireUpdate({ location_source: 'gps' });

  assert.equal(manualUpdate.$set.gps_error, 'gps_reacquiring');
  assert.equal(Object.hasOwn(manualUpdate.$unset, 'lat'), false);
  assert.equal(Object.hasOwn(manualUpdate.$unset, 'lng'), false);
  assert.equal(Object.hasOwn(manualUpdate.$unset, 'location_source'), false);
  assert.deepEqual(gpsUpdate.$unset, {
    lat: '',
    lng: '',
    location_source: '',
    location_updated_at: ''
  });
});

test('command model supports only the two GPS controls', () => {
  const commands = CommandModel.schema.path('command').enumValues;
  assert.deepEqual([...commands].sort(), ['gps_manual', 'gps_reacquire']);
});

test('a new GPS command supersedes only the opposite GPS command', () => {
  assert.equal(oppositeGpsCommand('gps_manual'), 'gps_reacquire');
  assert.equal(oppositeGpsCommand('gps_reacquire'), 'gps_manual');
  assert.equal(oppositeGpsCommand('other'), null);
});

test('admin reading edits pass measured values through without range checks', () => {
  const update = buildReadingUpdate({
    timestamp: '2026-08-25T08:30:00.000Z',
    air_temp: 34.5,
    humidity: 48,
    particle_adc: 104,
    rssi: -76,
    snr: 7.5
  });

  assert.equal(update.$set.air_temp, 34.5);
  assert.equal(update.$set.particle_adc, 104);
  assert.equal(update.$set.timestamp, '2026-08-25T08:30:00.000Z');
  assert.equal(buildReadingUpdate({ humidity: 101 }).$set.humidity, 101);
  assert.equal(buildReadingUpdate({ timestamp: null }).$set.timestamp, null);
  assert.deepEqual(buildReadingUpdate({ state: 'NORMAL' }), { $set: {} });
});

test('bulk reading deletion validates, deduplicates, and limits ids', () => {
  const firstId = '507f1f77bcf86cd799439011';
  const secondId = '507f191e810c19729de860ea';

  assert.deepEqual(normalizeReadingIds([firstId, firstId, secondId]), [firstId, secondId]);
  assert.throws(() => normalizeReadingIds([]), /non-empty/);
  assert.throws(() => normalizeReadingIds(['not-an-object-id']), /invalid/);
  assert.throws(() => normalizeReadingIds(Array.from({ length: 501 }, (_, index) =>
    index.toString(16).padStart(24, '0'))), /more than 500/);
});

test('delete-all reading scope accepts one explicit safe node id only', () => {
  assert.equal(normalizeNodeId(' NODE02 '), 'NODE02');
  assert.equal(normalizeNodeId('field-node_03'), 'field-node_03');
  assert.throws(() => normalizeNodeId(''), /node_id is invalid/);
  assert.throws(() => normalizeNodeId('../NODE01'), /node_id is invalid/);
  assert.throws(() => normalizeNodeId('NODE01,NODE02'), /node_id is invalid/);
});

test('offline timeout marks a node offline after two missed reports', () => {
  const previousMinimum = process.env.OFFLINE_TIMEOUT_MS;
  process.env.OFFLINE_TIMEOUT_MS = '60000';

  assert.equal(offlineTimeoutMs({ report_interval_sec: 300 }), 600000);
  assert.equal(offlineTimeoutMs({ report_interval_sec: 120 }), 240000);
  assert.equal(offlineTimeoutMs({ report_interval_sec: 20 }), 40000);
  assert.equal(offlineTimeoutMs({ report_interval_sec: 60 }), 120000);
  assert.equal(offlineTimeoutMs({}), 60000);

  if (previousMinimum === undefined) delete process.env.OFFLINE_TIMEOUT_MS;
  else process.env.OFFLINE_TIMEOUT_MS = previousMinimum;
});

test('node listing keeps offline nodes so the dashboard can show their last data', () => {
  const statuses = buildNodeStatusList([
    {
      node_id: 'NODE01',
      last_seen: new Date(),
      report_interval_sec: 300,
      state: 'NORMAL'
    },
    {
      node_id: 'NODE02',
      last_seen: new Date(0),
      report_interval_sec: 300,
      state: 'NORMAL'
    }
  ]);

  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].online, true);
  assert.equal(statuses[1].online, false);
  assert.equal(statuses[1].state, 'NORMAL');
});

test('WATCH and SENSOR_FAULT open alerts and reach Telegram', () => {
  const { ALERT_LEVELS } = require('../src/services/alertService');
  assert.ok(ALERT_LEVELS.includes('WATCH'));
  assert.ok(ALERT_LEVELS.includes('SENSOR_FAULT'));

  const message = buildTelegramMessage('created', {
    node_id: 'NODE02',
    level: 'WATCH'
  }, {
    state: 'WATCH',
    air_temp: 36,
    humidity: 45,
    particle_adc: 200
  }, { timezone: 'Asia/Bangkok' });

  assert.match(message, /WATCH \(เฝ้าระวัง\)/);
  assert.match(message, /NODE02/);
});

test('an unsent Telegram alert is retried without duplicating a delivered level', () => {
  assert.equal(shouldNotifyLevel('WATCH', undefined), true);
  assert.equal(shouldNotifyLevel('WATCH', 'WATCH'), false);
  assert.equal(shouldNotifyLevel('WARNING', 'WATCH'), true);
});

test('Telegram alert uses the reported state and measured values', () => {
  const message = buildTelegramMessage('created', {
    node_id: 'NODE01',
    level: 'WARNING',
    started_at: '2026-08-21T07:35:00.000Z'
  }, {
    state: 'WARNING',
    air_temp: 39.4,
    humidity: 32,
    particle_adc: 1200,
    timestamp: '2026-08-21T07:35:00.000Z'
  }, {
    dashboardUrl: 'https://wildfire.example.test',
    timezone: 'Asia/Bangkok'
  });

  assert.match(message, /WARNING \(เตือนภัย\)/);
  assert.doesNotMatch(message, /\/100/);
  assert.doesNotMatch(message, /สาเหตุ/);
  assert.match(message, /39.4°C/);
  assert.match(message, /32%/);
  assert.match(message, /1,200 ADC/);
  assert.match(message, /https:\/\/wildfire\.example\.test/);
});

test('Telegram resolved message and configuration are safe by default', () => {
  const message = buildTelegramMessage('resolved', {
    node_id: 'NODE<01>',
    level: 'WARNING',
    ended_at: '2026-08-21T08:00:00.000Z'
  }, undefined, { timezone: 'Asia/Bangkok' });

  assert.match(message, /เหตุการณ์สิ้นสุดแล้ว/);
  assert.match(message, /NORMAL \(ปกติ\)/);
  assert.match(message, /NODE&lt;01&gt;/);
  assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
  assert.equal(isTelegramConfigured({}), false);
  assert.equal(isTelegramConfigured({ TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: '@channel' }), true);
});

function mockRequest({ remoteAddress, headers = {} }) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    socket: { remoteAddress },
    get(name) {
      return normalized[String(name).toLowerCase()];
    }
  };
}

test('Cloudflare Access JWT is required for tunnel administrator access', async () => {
  const config = {
    hostname: 'admin.nattaphat.me',
    teamDomain: 'https://forestguard.cloudflareaccess.com',
    audience: 'forestguard-admin-audience'
  };
  const verifyToken = async (token, actualConfig) => {
    assert.equal(actualConfig, config);
    if (token !== 'valid-token') throw new Error('invalid signature');
    return { email: 'owner@example.com' };
  };
  const publicRequest = mockRequest({
    remoteAddress: '127.0.0.1',
    headers: {
      host: 'wildfire.nattaphat.me',
      'cf-connecting-ip': '203.0.113.10',
      'cf-access-jwt-assertion': 'forged',
      'cf-access-authenticated-user-email': 'owner@example.com'
    }
  });
  const adminRequest = mockRequest({
    remoteAddress: '127.0.0.1',
    headers: {
      host: 'admin.nattaphat.me',
      'cf-connecting-ip': '203.0.113.10',
      'cf-access-jwt-assertion': 'valid-token',
      'cf-access-authenticated-user-email': 'spoofed@example.com'
    }
  });
  const invalidTokenRequest = mockRequest({
    remoteAddress: '127.0.0.1',
    headers: {
      host: 'admin.nattaphat.me',
      'cf-connecting-ip': '203.0.113.10',
      'cf-access-jwt-assertion': 'forged'
    }
  });
  const forgedLanRequest = mockRequest({
    remoteAddress: '192.168.1.50',
    headers: {
      host: 'admin.nattaphat.me',
      'cf-connecting-ip': '203.0.113.10',
      'cf-access-jwt-assertion': 'forged',
      'cf-access-authenticated-user-email': 'owner@example.com'
    }
  });
  const localRequest = mockRequest({ remoteAddress: '::1' });

  assert.equal(await isTrustedAdminRequest(publicRequest, config, verifyToken), false);
  assert.equal(await isTrustedAdminRequest(adminRequest, config, verifyToken), true);
  assert.deepEqual(adminRequest.accessIdentity, { email: 'owner@example.com' });
  assert.equal(await isTrustedAdminRequest(invalidTokenRequest, config, verifyToken), false);
  assert.equal(await isTrustedAdminRequest(forgedLanRequest, config, verifyToken), false);
  assert.equal(await isTrustedAdminRequest(localRequest, config, verifyToken), true);
});

test('Cloudflare Access configuration has no duplicate administrator email list', () => {
  const config = adminConfigFromEnvironment({
    ADMIN_HOSTNAME: 'ADMIN.NATTAPHAT.ME',
    CF_ACCESS_TEAM_DOMAIN: 'sweet-leaf-5bae.cloudflareaccess.com/',
    CF_ACCESS_AUD: 'forestguard-admin-audience'
  });

  assert.deepEqual(config, {
    hostname: 'admin.nattaphat.me',
    teamDomain: 'https://sweet-leaf-5bae.cloudflareaccess.com',
    audience: 'forestguard-admin-audience'
  });
  assert.equal(normalizeTeamDomain('https://example.com'), '');
  assert.equal(normalizeTeamDomain('http://sweet-leaf-5bae.cloudflareaccess.com'), '');
});

test('production dashboard on localhost can call its same-machine API', async () => {
  const previousOrigins = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = 'https://wildfire.example.test';
  const options = corsOptions();
  const allowed = await new Promise((resolve, reject) => {
    options.origin('http://localhost:4000', (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

  assert.equal(allowed, true);
  if (previousOrigins === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = previousOrigins;
});
