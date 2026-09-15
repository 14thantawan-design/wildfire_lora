const test = require('node:test');
const assert = require('node:assert/strict');
const NodeModel = require('../src/models/Node');
const Reading = require('../src/models/Reading');
const Alert = require('../src/models/Alert');
const { handleSensorPacket, validateSensorPacket } = require('../src/services/packetHandler');
const {
  RISK_MODEL_VERSION,
  decodeRiskReasons,
  normalizeRiskState,
  riskFromPacket
} = require('../src/services/nodeRisk');
const { serializeReading } = require('../src/routes/readings');
const { withOnlineStatus } = require('../src/routes/nodes');
const { serializeAlert } = require('../src/routes/alerts');
const { buildTelegramMessage } = require('../src/services/telegramService');

function packet(overrides = {}) {
  return {
    t: 's', id: 'NODE01', sid: 10, q: 1,
    st: 'NORMAL', rb: 0, rv: RISK_MODEL_VERSION,
    at: 30, h: 70, pm: 20, sh: 'OK', ri: 300,
    ...overrides
  };
}

function query(value) {
  return {
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
  };
}

test('risk model 7 accepts reason bits without a score and rejects retired states', () => {
  assert.equal(validateSensorPacket(packet()), null);
  assert.match(validateSensorPacket(packet({ st: 'CRITICAL' })), /state/);
  assert.match(validateSensorPacket(packet({ st: 'CALIBRATING' })), /state/);
  assert.match(validateSensorPacket(packet({ t: 'c' })), /type/);
  assert.match(validateSensorPacket(packet({ sh: 'CAL' })), /health/);
  assert.match(validateSensorPacket(packet({ rb: undefined })), /reason bits/);
  assert.match(validateSensorPacket(packet({ rb: 256 })), /reason bits/);
  assert.match(validateSensorPacket(packet({ st: 'NORMAL', rb: 8 })), /reason bits/);
  assert.match(validateSensorPacket(packet({ st: 'WATCH', rb: 1 })), /reason bits/);
  assert.match(validateSensorPacket(packet({ st: 'WARNING', rb: 32 })), /reason bits/);
  assert.match(validateSensorPacket(packet({ st: 'SENSOR_FAULT', rb: 64 })), /disagree/);
  assert.match(validateSensorPacket(packet({ st: 'WARNING', rb: 1, ri: 120 })), /interval/);
  assert.equal(validateSensorPacket(packet({ st: 'WATCH', rb: 128, ri: 120 })), null);
  assert.equal(validateSensorPacket(packet({ st: 'WARNING', rb: 129, ri: 20 })), null);
  assert.equal(validateSensorPacket(packet({ st: 'WARNING', rb: 1, ri: 5 })), null);
  assert.equal(validateSensorPacket(packet({
    st: 'SENSOR_FAULT', rb: 64, sh: 'FAULT', at: null, h: null, pm: null
  })), null);

  const risk = riskFromPacket(packet({ st: 'WARNING', rb: 0b00000111 }));
  assert.deepEqual(risk, {
    state: 'WARNING',
    risk_reason_bits: 0b00000111,
    risk_reasons: ['temperature_above_45', 'particle_above_150', 'hot_dry_30_30'],
    risk_source: 'node',
    risk_model_version: 7
  });
});

test('legacy packets remain readable while current API states are normalized', () => {
  const legacy = packet({ st: 'CRITICAL', c: 80, rv: 6 });
  delete legacy.rb;
  assert.equal(validateSensorPacket(legacy), null);
  assert.deepEqual(riskFromPacket(legacy), {
    state: 'WARNING', risk_score: 80, risk_reason_bits: 0, risk_reasons: [],
    risk_source: 'node', risk_model_version: 6
  });
  assert.equal(normalizeRiskState('CRITICAL'), 'WARNING');
  assert.equal(normalizeRiskState('CALIBRATING'), 'UNKNOWN');
  assert.equal(normalizeRiskState('anything-else'), 'UNKNOWN');
});

test('historical records prefer the original node decision without mutating history', () => {
  const old = {
    state: 'WATCH', server_state: 'WATCH', server_risk_score: 35,
    node_state: 'CRITICAL', node_confidence: 80,
    server_reasons: ['smoke_weak'], evidence: { heat: 'none' }
  };
  const normalized = serializeReading(old);
  assert.equal(normalized.state, 'WARNING');
  assert.equal(normalized.node_state, 'WARNING');
  assert.equal(normalized.risk_score, 80);
  assert.equal(normalized.risk_model_version, 1);
  assert.equal(normalized.server_state, undefined);
  assert.equal(normalized.evidence, undefined);
  assert.equal(old.state, 'WATCH');
});

test('current schema stores explicit reasons and no generated server decision', () => {
  const risk = riskFromPacket(packet({ st: 'WATCH', rb: 0b00110000 }));
  const node = new NodeModel({ node_id: 'NODE01', ...risk }).toObject();
  const reading = new Reading({ node_id: 'NODE01', raw_packet: packet(), ...risk }).toObject();

  for (const obj of [node, reading]) {
    assert.equal(obj.state, 'WATCH');
    assert.equal(obj.risk_score, undefined);
    assert.equal(obj.risk_reason_bits, 0b00110000);
    assert.deepEqual(obj.risk_reasons, ['particle_above_50', 'humidity_below_50']);
    assert.equal(obj.server_state, undefined);
    assert.equal(obj.server_risk_score, undefined);
  }
  assert.deepEqual(decodeRiskReasons(0b11000000), [
    'sensor_fault', 'recovery_confirmation_pending'
  ]);
  assert.deepEqual(decodeRiskReasons(0b00111000), [
    'temperature_above_35', 'particle_above_50', 'humidity_below_50'
  ]);
});

test('ingestion, storage, live API, alerts and Telegram use firmware v7 end to end', async (t) => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousChat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  t.after(() => {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = previousChat;
  });

  const readings = [];
  let snapshot = null;
  let active = null;
  let closes = 0;
  t.mock.method(Reading, 'findOne', () => query(null));
  t.mock.method(Reading, 'find', () => {
    throw new Error('Firmware-confirmed NORMAL must not get a second recovery delay');
  });
  t.mock.method(Reading, 'create', async (data) => {
    const row = new Reading({ ...data });
    await row.validate();
    readings.push(row.toObject());
    return row;
  });
  t.mock.method(NodeModel, 'findOne', () => query(snapshot));
  t.mock.method(NodeModel, 'findOneAndUpdate', async (_filter, update) => {
    snapshot = update.$set;
    return snapshot;
  });
  t.mock.method(Alert, 'findOne', () => query(active));
  t.mock.method(Alert, 'create', async (data) => {
    active = { ...data, _id: 'alert-test', save: async () => {} };
    return active;
  });
  t.mock.method(Alert, 'updateMany', async () => {
    closes += 1;
    const count = active ? 1 : 0;
    active = null;
    return { modifiedCount: count };
  });

  const warning = packet({ st: 'WARNING', rb: 0b00000110, pm: 170, at: 30, h: 30, ri: 20 });
  const first = await handleSensorPacket(warning);
  assert.equal(first.alert.action, 'created');
  assert.equal(readings[0].state, 'WARNING');
  assert.equal(readings[0].risk_score, undefined);
  assert.equal(readings[0].risk_reason_bits, 0b00000110);
  assert.deepEqual(readings[0].risk_reasons, ['particle_above_150', 'hot_dry_30_30']);
  assert.equal(snapshot.state, 'WARNING');
  assert.equal(snapshot.report_interval_sec, 20);
  assert.equal(active.level, 'WARNING');
  assert.deepEqual(active.reasons, ['particle_above_150', 'hot_dry_30_30']);

  const message = buildTelegramMessage('created', active, active.last_reading);
  assert.doesNotMatch(message, /\/100/);
  assert.match(message, /สูงกว่า 150/);
  assert.match(message, /ความชื้นไม่เกิน 30/);

  // Backend trusts the firmware state and does not calculate thresholds again.
  const normal = await handleSensorPacket(packet({ q: 2, st: 'NORMAL', rb: 0, at: 50, h: 20, pm: 360 }));
  assert.equal(normal.alert.action, 'closed');
  assert.equal(closes, 1);
  assert.equal(snapshot.state, 'NORMAL');
  assert.equal(snapshot.risk_score, undefined);
  assert.equal(active, null);
  assert.equal(serializeReading(readings[1]).state, 'NORMAL');
  assert.equal(withOnlineStatus(snapshot).risk_score, undefined);

  await handleSensorPacket(packet({ q: 3, st: 'SENSOR_FAULT', rb: 1 << 6, sh: 'FAULT', at: null, h: null }));
  assert.equal(active.level, 'SENSOR_FAULT');
  assert.equal(snapshot.state, 'SENSOR_FAULT');
  assert.deepEqual(snapshot.risk_reasons, ['sensor_fault']);
});

test('alert API maps historical CRITICAL to current WARNING', () => {
  const serialized = serializeAlert({
    level: 'CRITICAL',
    max_state: 'CRITICAL',
    telegram_notified_level: 'CRITICAL',
    last_reading: { node_state: 'CRITICAL', risk_model_version: 6, risk_score: 80 }
  });
  assert.equal(serialized.level, 'WARNING');
  assert.equal(serialized.max_state, 'WARNING');
  assert.equal(serialized.telegram_notified_level, 'WARNING');
  assert.equal(serialized.last_reading.state, 'WARNING');
});
