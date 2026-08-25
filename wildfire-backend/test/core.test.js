const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateRisk } = require('../src/services/riskEngine');
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
const { isTrustedAdminRequest } = require('../src/middleware/security');
const CommandModel = require('../src/models/Command');
const { buildGpsReacquireUpdate, offlineTimeoutMs } = require('../src/routes/nodes');
const { buildReadingUpdate, normalizeReadingIds } = require('../src/routes/readings');
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
    c: 12,
    at: 30,
    h: 60,
    sm: 100,
    sh: 'OK',
    ...overrides
  };
}

test('humidity drop uses the firmware current-minus-baseline sign', () => {
  const drop = evaluateRisk(validSensorPacket({ sm: 1200, hr: -15 }));
  const rise = evaluateRisk(validSensorPacket({ sm: 1200, hr: 15 }));

  assert.equal(drop.evidence.humidity, 'critical_drop');
  assert.equal(rise.evidence.humidity, 'none');
});

test('sensor validation rejects incomplete or impossible packets', () => {
  assert.equal(validateSensorPacket(validSensorPacket()), null);
  assert.match(validateSensorPacket({ t: 's', id: 'NODE01' }), /sequence/);
  assert.match(validateSensorPacket(validSensorPacket({ sm: 5000 })), /smoke/);
  assert.match(validateSensorPacket(validSensorPacket({ sh: 'OK', at: null })), /missing/);
});

test('GPS validation requires a real coordinate when fixed', () => {
  assert.equal(validateGpsPacket({
    t: 'gps', id: 'NODE01', q: 11, sid: 1234, gf: 1, la: 14.9, ln: 102.1, sat: 7, hd: 1.2
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
    gps_satellites: '',
    gps_hdop: '',
    lat: '',
    lng: '',
    location_source: '',
    location_updated_at: ''
  });
});

test('GPS command model supports manual mode and reacquisition', () => {
  const commands = CommandModel.schema.path('command').enumValues;
  assert.deepEqual([...commands].sort(), ['gps_manual', 'gps_reacquire']);
});

test('admin reading edits only accept measured fields in sensor ranges', () => {
  const update = buildReadingUpdate({
    timestamp: '2026-08-25T08:30:00.000Z',
    air_temp: 34.5,
    humidity: 48,
    smoke_raw: 620,
    sensor_health: 'ok',
    rssi: -76,
    snr: 7.5
  });

  assert.equal(update.$set.air_temp, 34.5);
  assert.equal(update.$set['raw_packet.at'], 34.5);
  assert.equal(update.$set.sensor_health, 'OK');
  assert.equal(update.$set['raw_packet.sh'], 'OK');
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

  assert.equal(offlineTimeoutMs({ report_interval_sec: 600 }), 1530000);
  assert.equal(offlineTimeoutMs({ report_interval_sec: 120 }), 330000);

  if (previousMultiplier === undefined) delete process.env.OFFLINE_INTERVAL_MULTIPLIER;
  else process.env.OFFLINE_INTERVAL_MULTIPLIER = previousMultiplier;
  if (previousJitter === undefined) delete process.env.OFFLINE_JITTER_GRACE_MS;
  else process.env.OFFLINE_JITTER_GRACE_MS = previousJitter;
  if (previousMinimum === undefined) delete process.env.OFFLINE_TIMEOUT_MS;
  else process.env.OFFLINE_TIMEOUT_MS = previousMinimum;
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
  }), false);
  assert.equal(isFirmwareConfirmedNormal({
    server_state: 'NORMAL', raw_packet: { st: 'NORMAL' }
  }), true);
});

test('critical fire outranks a sensor fault', () => {
  assert.ok(severityOf('CRITICAL') > severityOf('SENSOR_FAULT'));
});

test('WATCH is an alert level so early warning reaches Telegram', () => {
  const { ALERT_LEVELS } = require('../src/services/alertService');
  assert.ok(ALERT_LEVELS.includes('WATCH'));

  const message = buildTelegramMessage('created', {
    node_id: 'NODE02',
    level: 'WATCH'
  }, {
    server_state: 'WATCH',
    server_risk_score: 35,
    server_reasons: ['smoke_weak']
  }, { timezone: 'Asia/Bangkok' });

  assert.match(message, /WATCH \(เฝ้าระวัง\)/);
  assert.match(message, /NODE02/);
});

test('an unsent Telegram alert is retried without duplicating a delivered level', () => {
  assert.equal(shouldNotifyLevel('WATCH', undefined), true);
  assert.equal(shouldNotifyLevel('WATCH', 'WATCH'), false);
  assert.equal(shouldNotifyLevel('WARNING', 'WATCH'), true);
  assert.equal(shouldNotifyLevel('CRITICAL', 'WARNING'), true);
});

test('Telegram alert uses the existing server state and Thai reason labels', () => {
  const message = buildTelegramMessage('created', {
    node_id: 'NODE01',
    level: 'WARNING',
    started_at: '2026-08-21T07:35:00.000Z'
  }, {
    server_state: 'WARNING',
    server_risk_score: 62,
    server_reasons: ['smoke_strong', 'humidity_dry'],
    air_temp: 39.4,
    humidity: 32,
    smoke_raw: 1280,
    timestamp: '2026-08-21T07:35:00.000Z'
  }, {
    dashboardUrl: 'https://wildfire.example.test',
    timezone: 'Asia/Bangkok'
  });

  assert.match(message, /WARNING \(เตือนภัย\)/);
  assert.match(message, /62\/100/);
  assert.match(message, /พบสัญญาณควันชัดเจน/);
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

test('public tunnel traffic cannot use loopback to gain administrator access', () => {
  const config = {
    hostname: 'admin.nattaphat.me',
    emails: new Set(['owner@example.com'])
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
      'cf-access-jwt-assertion': 'validated-by-cloudflared',
      'cf-access-authenticated-user-email': 'owner@example.com'
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

  assert.equal(isTrustedAdminRequest(publicRequest, config), false);
  assert.equal(isTrustedAdminRequest(adminRequest, config), true);
  assert.equal(isTrustedAdminRequest(forgedLanRequest, config), false);
  assert.equal(isTrustedAdminRequest(localRequest, config), true);
});
