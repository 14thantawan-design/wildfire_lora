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
const {
  adminConfigFromEnvironment,
  corsOptions,
  isTrustedAdminRequest,
  normalizeTeamDomain
} = require('../src/middleware/security');
const CommandModel = require('../src/models/Command');
const {
  buildBaselineProgressUpdate,
  isBaselineCalibrationInProgress,
  oppositeGpsCommand
} = require('../src/services/commandQueue');
const {
  baselineRecalibrationBlock,
  buildBaselineRecalibrationSnapshot,
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

test('command model supports GPS controls and safe baseline recalibration', () => {
  const commands = CommandModel.schema.path('command').enumValues;
  assert.deepEqual([...commands].sort(), [
    'baseline_recalibrate',
    'gps_manual',
    'gps_reacquire'
  ]);
});

test('a new GPS command supersedes only the opposite GPS command', () => {
  assert.equal(oppositeGpsCommand('gps_manual'), 'gps_reacquire');
  assert.equal(oppositeGpsCommand('gps_reacquire'), 'gps_manual');
  assert.equal(oppositeGpsCommand('baseline_recalibrate'), null);
});

test('baseline recalibration is blocked for offline, unsafe, or faulty nodes', () => {
  const safeNode = {
    node_id: 'NODE01',
    last_seen: new Date(),
    report_interval_sec: 600,
    node_state: 'NORMAL',
    state: 'NORMAL',
    server_state: 'NORMAL',
    sensor_health: 'OK',
    smoke_raw: 100,
    air_temp: 30,
    humidity: 60
  };

  assert.equal(baselineRecalibrationBlock(safeNode), null);
  assert.equal(baselineRecalibrationBlock({
    ...safeNode,
    node_state: 'WARNING',
    state: 'WATCH',
    server_state: 'WATCH',
    air_temp: 38,
    humidity: 48
  }), null);
  assert.equal(baselineRecalibrationBlock({
    ...safeNode,
    node_state: 'WARNING',
    state: 'WARNING',
    server_state: 'WARNING'
  }).code, 'unsafe_state');
  assert.equal(baselineRecalibrationBlock({ ...safeNode, node_state: 'CRITICAL' }).code, 'unsafe_state');
  assert.equal(baselineRecalibrationBlock({ ...safeNode, sensor_health: 'FAULT' }).code, 'sensor_not_ready');
  assert.equal(baselineRecalibrationBlock({ ...safeNode, smoke_raw: 1200 }).code, 'unsafe_reading');
  assert.equal(baselineRecalibrationBlock({ ...safeNode, last_seen: new Date(0) }).code, 'node_offline');
});

test('baseline recalibration snapshot exposes queue and calibration progress', () => {
  const node = {
    node_id: 'NODE01',
    last_seen: new Date(),
    report_interval_sec: 30,
    node_state: 'CALIBRATING',
    state: 'CALIBRATING',
    server_state: 'CALIBRATING',
    baseline_warmup_count: 4,
    baseline_warmup_target: 12
  };
  const command = {
    command_id: 'cmd_1',
    status: 'acknowledged',
    acknowledged_at: new Date(Date.now() - 1000),
    baseline_started_at: new Date()
  };
  const snapshot = buildBaselineRecalibrationSnapshot(node, command);

  assert.equal(snapshot.phase, 'calibrating');
  assert.equal(snapshot.baseline_warmup_count, 4);
  assert.equal(snapshot.baseline_warmup_target, 12);
});

test('baseline progress remains calibrating when WATCH still reports CAL and an incomplete count', () => {
  const node = {
    node_id: 'NODE01',
    last_seen: new Date(),
    report_interval_sec: 120,
    node_state: 'WATCH',
    state: 'NORMAL',
    server_state: 'NORMAL',
    sensor_health: 'CAL',
    baseline_warmup_count: 9,
    baseline_warmup_target: 12
  };
  const command = {
    command_id: 'cmd_stale_completed',
    status: 'acknowledged',
    baseline_started_at: new Date(Date.now() - 60000),
    completed_at: new Date(Date.now() - 30000)
  };

  assert.equal(isBaselineCalibrationInProgress(node), true);
  assert.equal(buildBaselineRecalibrationSnapshot(node, command).phase, 'calibrating');
  assert.equal(baselineRecalibrationBlock(node).code, 'already_calibrating');
});

test('baseline command completion follows sensor health instead of a temporary WATCH state', () => {
  const startedAt = new Date('2026-08-31T02:30:00.000Z');
  const completedAt = new Date('2026-08-31T02:40:00.000Z');
  const command = { baseline_started_at: startedAt };

  assert.deepEqual(buildBaselineProgressUpdate(command, {
    node_state: 'WATCH',
    sensor_health: 'CAL',
    baseline_warmup_count: 9,
    baseline_warmup_target: 12
  }, completedAt), null);

  assert.deepEqual(buildBaselineProgressUpdate(command, {
    node_state: 'NORMAL',
    sensor_health: 'OK',
    baseline_warmup_count: null,
    baseline_warmup_target: null
  }, completedAt), { $set: { completed_at: completedAt } });

  assert.deepEqual(buildBaselineProgressUpdate({
    baseline_started_at: startedAt,
    completed_at: new Date('2026-08-31T02:35:00.000Z')
  }, {
    node_state: 'WATCH',
    sensor_health: 'CAL',
    baseline_warmup_count: 9,
    baseline_warmup_target: 12
  }, completedAt), { $unset: { completed_at: 1 } });
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

  assert.equal(offlineTimeoutMs({ report_interval_sec: 600 }), 1530000);
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
      report_interval_sec: 600,
      state: 'NORMAL'
    },
    {
      node_id: 'NODE02',
      last_seen: new Date(0),
      report_interval_sec: 600,
      state: 'NORMAL'
    }
  ]);

  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].online, true);
  assert.equal(statuses[1].online, false);
  assert.equal(statuses[1].server_state, 'OFFLINE');
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
