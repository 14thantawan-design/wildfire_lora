const test = require('node:test');
const assert = require('node:assert/strict');

const { riskFromPacket } = require('../src/services/nodeRisk');
const {
  buildPacketIdentity,
  isOutOfOrderPacket,
  validateGpsPacket,
  validateSensorPacket
} = require('../src/services/packetHandler');
const {
  hasDistinctNormalStreak,
  isFirmwareConfirmedNormal,
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

function validSensorPacket(overrides = {}) {
  return {
    t: 's',
    id: 'NODE01',
    q: 10,
    sid: 1234,
    st: 'NORMAL',
    rb: 0,
    rv: 7,
    at: 30,
    h: 60,
    pm: 20,
    sh: 'OK',
    ri: 300,
    ...overrides
  };
}

test('backend preserves a node decision regardless of sensor values', () => {
  for (const values of [{ pm: 0, at: 50, h: 20 }, { pm: 170, at: 30, h: 95 }]) {
    assert.deepEqual(riskFromPacket(validSensorPacket({ ...values, st: 'WARNING', rb: 2 })), {
      state: 'WARNING', risk_reason_bits: 2,
      risk_reasons: ['particle_above_150'], risk_source: 'node', risk_model_version: 7
    });
  }
});

test('sensor validation rejects incomplete or impossible packets', () => {
  assert.equal(validateSensorPacket(validSensorPacket()), null);
  assert.match(validateSensorPacket({ t: 's', id: 'NODE01' }), /sequence/);
  assert.match(validateSensorPacket(validSensorPacket({ pm: 2001 })), /particle/);
  assert.match(validateSensorPacket(validSensorPacket({ pm: 2001, sm: 100 })), /particle/);
  assert.match(validateSensorPacket(validSensorPacket({ pm: 20, sm: 5000 })), /legacy smoke/);
  assert.match(validateSensorPacket(validSensorPacket({ sh: 'OK', at: null })), /missing/);

  const legacyPacket = validSensorPacket({ sm: 100, rv: 6, c: 20 });
  delete legacyPacket.pm;
  delete legacyPacket.rb;
  assert.equal(validateSensorPacket(legacyPacket), null);
});

test('GPS validation requires a real coordinate when fixed', () => {
  assert.equal(validateGpsPacket({
    t: 'gps', id: 'NODE01', q: 11, sid: 1234, gf: 1, la: 14.9, ln: 102.1
  }), null);
  assert.match(validateGpsPacket({
    t: 'gps', id: 'NODE01', q: 11, sid: 1234, gf: 1, la: 200, ln: 102.1
  }), /coordinates/);
});

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

test('admin reading edits only accept measured fields in sensor ranges', () => {
  const update = buildReadingUpdate({
    timestamp: '2026-08-25T08:30:00.000Z',
    air_temp: 34.5,
    humidity: 48,
    particle_ug_m3: 104,
    sensor_health: 'ok',
    rssi: -76,
    snr: 7.5
  });

  assert.equal(update.$set.air_temp, 34.5);
  assert.equal(update.$set['raw_packet.at'], 34.5);
  assert.equal(update.$set.sensor_health, 'OK');
  assert.equal(update.$set['raw_packet.sh'], 'OK');
  assert.equal(update.$set.particle_ug_m3, 104);
  assert.equal(update.$set['raw_packet.pm'], 104);
  assert.equal(update.$set.timestamp.toISOString(), '2026-08-25T08:30:00.000Z');
  assert.throws(() => buildReadingUpdate({ humidity: 101 }), /out of range/);
  assert.throws(() => buildReadingUpdate({ timestamp: null }), /timestamp is invalid/);
  assert.throws(() => buildReadingUpdate({ server_state: 'NORMAL' }), /no editable/);
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

test('packet identity ignores transport signal metadata', () => {
  const now = new Date('2026-07-15T00:00:00.000Z');
  const first = buildPacketIdentity(validSensorPacket({ rssi: -40, snr: 8 }), now);
  const retry = buildPacketIdentity(validSensorPacket({ rssi: -45, snr: 7 }), now);

  assert.equal(first.packetId, retry.packetId);
  assert.equal(first.packetHash, retry.packetHash);
});

test('older packets in the same boot session cannot overwrite the live node snapshot', () => {
  const node = { session_id: 1234, last_seq: 42 };

  assert.equal(isOutOfOrderPacket(node, validSensorPacket({ sid: 1234, q: 41 })), true);
  assert.equal(isOutOfOrderPacket(node, validSensorPacket({ sid: 1234, q: 42 })), true);
  assert.equal(isOutOfOrderPacket(node, validSensorPacket({ sid: 1234, q: 43 })), false);
  assert.equal(isOutOfOrderPacket(node, validSensorPacket({ sid: 5678, q: 1 })), false);
});

test('adaptive offline timeout tolerates one missed field report', () => {
  const previousMultiplier = process.env.OFFLINE_INTERVAL_MULTIPLIER;
  const previousJitter = process.env.OFFLINE_JITTER_GRACE_MS;
  const previousMinimum = process.env.OFFLINE_TIMEOUT_MS;
  delete process.env.OFFLINE_INTERVAL_MULTIPLIER;
  delete process.env.OFFLINE_JITTER_GRACE_MS;
  process.env.OFFLINE_TIMEOUT_MS = '60000';

  assert.equal(offlineTimeoutMs({ report_interval_sec: 300 }), 780000);
  assert.equal(offlineTimeoutMs({ report_interval_sec: 120 }), 330000);

  if (previousMultiplier === undefined) delete process.env.OFFLINE_INTERVAL_MULTIPLIER;
  else process.env.OFFLINE_INTERVAL_MULTIPLIER = previousMultiplier;
  if (previousJitter === undefined) delete process.env.OFFLINE_JITTER_GRACE_MS;
  else process.env.OFFLINE_JITTER_GRACE_MS = previousJitter;
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
  assert.equal(Object.hasOwn(statuses[1], 'server_state'), false);
});

test('duplicate readings cannot satisfy the normal clean streak', () => {
  const duplicateRows = [1, 2, 3].map(() => ({
    server_state: 'NORMAL', session_id: 99, seq: 20
  }));
  const distinctRows = [20, 21, 22].map((seq) => ({
    server_state: 'NORMAL', session_id: 99, seq
  }));

  assert.equal(hasDistinctNormalStreak(duplicateRows, 3), false);
  assert.equal(hasDistinctNormalStreak(distinctRows, 3), true);
});

test('firmware-confirmed NORMAL avoids a second three-report recovery delay', () => {
  assert.equal(isFirmwareConfirmedNormal({
    server_state: 'NORMAL', node_state: 'NORMAL'
  }), true);
  assert.equal(isFirmwareConfirmedNormal({
    server_state: 'NORMAL', node_state: 'WARNING'
  }), false);
  assert.equal(isFirmwareConfirmedNormal({
    server_state: 'WARNING', node_state: 'NORMAL'
  }), true);
  assert.equal(isFirmwareConfirmedNormal({
    server_state: 'NORMAL', raw_packet: { st: 'NORMAL' }
  }), true);
});

test('WARNING outranks a sensor fault in alert priority', () => {
  assert.ok(severityOf('WARNING') > severityOf('SENSOR_FAULT'));
});

test('WATCH is an alert level so early warning reaches Telegram', () => {
  const { ALERT_LEVELS } = require('../src/services/alertService');
  assert.ok(ALERT_LEVELS.includes('WATCH'));

  const message = buildTelegramMessage('created', {
    node_id: 'NODE02',
    level: 'WATCH'
  }, {
    state: 'WATCH',
    risk_reasons: ['humidity_below_50']
  }, { timezone: 'Asia/Bangkok' });

  assert.match(message, /WATCH \(เฝ้าระวัง\)/);
  assert.match(message, /NODE02/);
});

test('an unsent Telegram alert is retried without duplicating a delivered level', () => {
  assert.equal(shouldNotifyLevel('WATCH', undefined), true);
  assert.equal(shouldNotifyLevel('WATCH', 'WATCH'), false);
  assert.equal(shouldNotifyLevel('WARNING', 'WATCH'), true);
  assert.equal(shouldNotifyLevel('SENSOR_FAULT', 'WATCH'), true);
  assert.equal(shouldNotifyLevel('WARNING', 'SENSOR_FAULT'), true);
});

test('Telegram alert uses the existing server state and Thai reason labels', () => {
  const message = buildTelegramMessage('created', {
    node_id: 'NODE01',
    level: 'WARNING',
    started_at: '2026-08-21T07:35:00.000Z'
  }, {
    state: 'WARNING',
    risk_reasons: ['particle_above_150', 'hot_dry_30_30'],
    air_temp: 39.4,
    humidity: 32,
    particle_ug_m3: 170,
    timestamp: '2026-08-21T07:35:00.000Z'
  }, {
    dashboardUrl: 'https://wildfire.example.test',
    timezone: 'Asia/Bangkok'
  });

  assert.match(message, /WARNING \(เตือนภัย\)/);
  assert.doesNotMatch(message, /\/100/);
  assert.match(message, /สูงกว่า 150/);
  assert.match(message, /ความชื้นไม่เกิน 30/);
  assert.match(message, /170 µg\/m³/);
  assert.match(message, /https:\/\/wildfire\.example\.test/);
});

test('Telegram resolved message and configuration are safe by default', () => {
  const message = buildTelegramMessage('resolved', {
    node_id: 'NODE<01>',
    level: 'CRITICAL',
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
    ADMIN_EMAILS: 'legacy@example.com',
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
