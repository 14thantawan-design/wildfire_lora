const test = require('node:test');
const assert = require('node:assert/strict');
const NodeModel = require('../src/models/Node');
const Reading = require('../src/models/Reading');
const Alert = require('../src/models/Alert');
const Command = require('../src/models/Command');
const { handleSensorPacket, validateSensorPacket } = require('../src/services/packetHandler');
const { riskFromPacket, normalizeNodeRisk } = require('../src/services/nodeRisk');
const { serializeReading } = require('../src/routes/readings');
const { withOnlineStatus } = require('../src/routes/nodes');
const { serializeAlert } = require('../src/routes/alerts');
const { buildTelegramMessage } = require('../src/services/telegramService');

function packet(overrides = {}) {
  return { t: 's', id: 'NODE01', sid: 10, q: 1, st: 'NORMAL', c: 0, rv: 2,
    at: 30, h: 70, sm: 100, sh: 'OK', ri: 600, ...overrides };
}

function query(value) {
  return { select() { return this; }, sort() { return this; }, limit() { return this; },
    lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}

test('old firmware is labelled version 1 and malformed versions are rejected', () => {
  const legacy = packet();
  delete legacy.rv;
  assert.equal(validateSensorPacket(legacy), null);
  assert.equal(riskFromPacket(legacy).risk_model_version, 1);
  for (const rv of [0, -1, 1.5, '2', null, 256]) {
    assert.match(validateSensorPacket(packet({ rv })), /version/);
  }
});

test('historical node decision wins over server recalculation without mutating history', () => {
  const old = { state: 'WATCH', server_state: 'WATCH', server_risk_score: 35,
    node_state: 'CRITICAL', node_confidence: 80, server_reasons: ['smoke_weak'], evidence: { heat: 'none' } };
  const normalized = serializeReading(old);
  assert.equal(normalized.state, 'CRITICAL');
  assert.equal(normalized.risk_score, 80);
  assert.equal(normalized.risk_model_version, 1);
  assert.equal(normalized.server_state, undefined);
  assert.equal(normalized.evidence, undefined);
  assert.equal(old.state, 'WATCH');
  const raw = normalizeNodeRisk({ raw_packet: { st: 'WARNING', c: 50 }, state: 'NORMAL' });
  assert.equal(raw.state, 'WARNING');
  assert.equal(raw.risk_score, 50);
  assert.equal(normalizeNodeRisk({ state: 'NORMAL' }).risk_score, null);
});

test('canonical node fields retain zero score and override leftover legacy fields', () => {
  const old = { risk_source: 'node', state: 'NORMAL', risk_score: 0, risk_model_version: 2,
    node_state: 'CRITICAL', node_confidence: 80, server_state: 'CRITICAL', server_risk_score: 95 };
  assert.equal(serializeReading(old).state, 'NORMAL');
  assert.equal(serializeReading(old).risk_score, 0);
  assert.equal(withOnlineStatus({ ...old, last_seen: new Date(), report_interval_sec: 600 }).state, 'NORMAL');
  const offline = withOnlineStatus({ ...old, last_seen: new Date(0) });
  assert.equal(offline.online, false);
  assert.equal(offline.state, 'NORMAL');
  assert.equal(serializeAlert({ level: 'CRITICAL', last_reading: old }).last_reading.server_state, undefined);
});

test('node schema does not add old server defaults to a new record', () => {
  const node = new NodeModel({ node_id: 'NODE01', ...riskFromPacket(packet()) }).toObject();
  const reading = new Reading({ node_id: 'NODE01', raw_packet: packet(), ...riskFromPacket(packet()) }).toObject();
  for (const obj of [node, reading]) {
    assert.equal(obj.risk_score, 0);
    assert.equal(obj.server_state, undefined);
    assert.equal(obj.server_risk_score, undefined);
    assert.equal(obj.server_reasons, undefined);
    assert.equal(obj.fire_danger_level, undefined);
  }
});

test('ingestion, storage, live API and alert recovery use the firmware result end to end', async (t) => {
  // Model mocks keep this regression test isolated from real MongoDB and Telegram.
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
  let snapshot = null, active = null, closes = 0;
  t.mock.method(Reading, 'findOne', () => query(null));
  t.mock.method(Reading, 'find', () => { throw new Error('No history scoring or second recovery delay allowed'); });
  t.mock.method(Reading, 'create', async (data) => {
    const row = new Reading({ ...data });
    await row.validate();
    readings.push(row.toObject());
    return row;
  });
  t.mock.method(NodeModel, 'findOne', () => query(snapshot));
  t.mock.method(NodeModel, 'findOneAndUpdate', async (_filter, update) => { snapshot = update.$set; return snapshot; });
  t.mock.method(Command, 'findOne', () => query(null));
  t.mock.method(Alert, 'findOne', () => query(active));
  t.mock.method(Alert, 'create', async (data) => {
    active = { ...data, _id: 'alert-test', save: async () => {} };
    return active;
  });
  t.mock.method(Alert, 'updateMany', async () => {
    closes++;
    const count = active ? 1 : 0;
    active = null;
    return { modifiedCount: count };
  });

  const critical = packet({ t: 'c', st: 'CRITICAL', c: 80, sm: 0, at: 36, h: 55 });
  const first = await handleSensorPacket(critical);
  assert.equal(first.alert.action, 'created');
  assert.equal(readings[0].state, 'CRITICAL');
  assert.equal(readings[0].risk_score, 80);
  assert.equal(snapshot.state, 'CRITICAL');
  assert.equal(snapshot.server_state, undefined);
  assert.equal(active.level, 'CRITICAL');
  assert.equal(active.max_risk_score, 80);
  assert.equal(active.last_reading.risk_model_version, 2);
  const message = buildTelegramMessage('created', active, active.last_reading);
  assert.match(message, /80\/100/);
  assert.match(message, /โหนดประเมิน/);

  // Even deliberately conflicting measurements must not trigger server scoring.
  const normal = await handleSensorPacket(packet({ q: 2, st: 'NORMAL', c: 0, at: 50, h: 20, sm: 1800 }));
  assert.equal(normal.alert.action, 'closed');
  assert.equal(closes, 1);
  assert.equal(snapshot.state, 'NORMAL');
  assert.equal(snapshot.risk_score, 0);
  assert.equal(active, null);
  assert.equal(serializeReading(readings[1]).state, 'NORMAL');
  assert.equal(withOnlineStatus(snapshot).risk_score, 0);

  await handleSensorPacket(packet({ q: 3, st: 'CALIBRATING', sh: 'CAL', bc: 5, bt: 12 }));
  assert.equal(snapshot.state, 'CALIBRATING');
  assert.equal(snapshot.baseline_warmup_count, 5);
  assert.equal(active, null);
  await handleSensorPacket(packet({ q: 4, st: 'SENSOR_FAULT', sh: 'FAULT', at: null, h: null }));
  assert.equal(active.level, 'SENSOR_FAULT');
  assert.equal(snapshot.state, 'SENSOR_FAULT');
});
