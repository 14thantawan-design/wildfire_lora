const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateRisk } = require('../src/services/riskEngine');
const {
  buildPacketIdentity,
  validateGpsPacket,
  validateSensorPacket
} = require('../src/services/packetHandler');
const {
  hasDistinctNormalStreak,
  severityOf,
  shouldNotifyLevel
} = require('../src/services/alertService');
const { isTrustedAdminRequest } = require('../src/middleware/security');
const { buildGpsReacquireUpdate } = require('../src/routes/nodes');
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

test('packet identity ignores transport signal metadata', () => {
  const now = new Date('2026-07-15T00:00:00.000Z');
  const first = buildPacketIdentity(validSensorPacket({ rssi: -40, snr: 8 }), now);
  const retry = buildPacketIdentity(validSensorPacket({ rssi: -45, snr: 7 }), now);

  assert.equal(first.packetId, retry.packetId);
  assert.equal(first.packetHash, retry.packetHash);
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
