const test = require('node:test');
const assert = require('node:assert/strict');
const NodeModel = require('../src/models/Node');
const Reading = require('../src/models/Reading');
const Alert = require('../src/models/Alert');
const { handleSensorPacket, validateSensorPacket } = require('../src/services/packetHandler');
const { riskFromPacket } = require('../src/services/nodeRisk');
const { serializeReading } = require('../src/routes/readings');
const { withOnlineStatus } = require('../src/routes/nodes');
const { buildTelegramMessage } = require('../src/services/telegramService');

function packet(overrides = {}) {
  return {
    t: 's', id: 'NODE01', sid: 10, q: 1,
    st: 'NORMAL',
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

test('sensor packet accepts a state without duplicated reason fields', () => {
  assert.equal(validateSensorPacket(packet()), null);
  assert.match(validateSensorPacket(packet({ st: 'INVALID' })), /state/);
  assert.match(validateSensorPacket(packet({ t: 'invalid' })), /type/);
  assert.match(validateSensorPacket(packet({ sh: 'INVALID' })), /health/);
  assert.match(validateSensorPacket(packet({ rb: 1 })), /unsupported field/);
  assert.match(validateSensorPacket(packet({ st: 'SENSOR_FAULT' })), /disagree/);
  assert.equal(validateSensorPacket(packet({
    st: 'SENSOR_FAULT', sh: 'FAULT', at: null, h: null, pm: null
  })), null);

  assert.deepEqual(riskFromPacket(packet({ st: 'WARNING' })), {
    state: 'WARNING'
  });
});

test('sensor report interval comes from firmware and uses whole seconds', () => {
  assert.equal(validateSensorPacket(packet({ st: 'WARNING', ri: 120 })), null);
  assert.equal(validateSensorPacket(packet({ st: 'WATCH', ri: 20 })), null);
  assert.equal(validateSensorPacket(packet({ st: 'NORMAL', ri: 5 })), null);
  assert.match(validateSensorPacket(packet({ ri: 0 })), /interval/);
  assert.match(validateSensorPacket(packet({ ri: 20.5 })), /interval/);
  assert.match(validateSensorPacket(packet({ ri: 86401 })), /interval/);
});

test('current schema stores only the firmware state', () => {
  const risk = riskFromPacket(packet({ st: 'WATCH' }));
  const node = new NodeModel({ node_id: 'NODE01', ...risk }).toObject();
  const reading = new Reading({ node_id: 'NODE01', ...risk }).toObject();

  for (const obj of [node, reading]) {
    assert.equal(obj.state, 'WATCH');
    assert.equal(Object.hasOwn(obj, 'risk_reason_bits'), false);
    assert.equal(Object.hasOwn(obj, 'risk_reasons'), false);
  }
});

test('ingestion, storage, live API, alerts and Telegram use firmware state end to end', async (t) => {
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

  const warning = packet({ st: 'WARNING', pm: 170, at: 30, h: 30, ri: 20 });
  const first = await handleSensorPacket(warning);
  assert.equal(first.alert.action, 'created');
  assert.equal(readings[0].state, 'WARNING');
  assert.equal(snapshot.state, 'WARNING');
  assert.equal(snapshot.report_interval_sec, 20);
  assert.equal(active.level, 'WARNING');
  assert.equal(Object.hasOwn(active, 'reasons'), false);

  const message = buildTelegramMessage('created', active, active.last_reading);
  assert.match(message, /30°C/);
  assert.match(message, /30%/);
  assert.match(message, /170 µg\/m³/);
  assert.doesNotMatch(message, /สาเหตุ/);

  // Backend trusts the firmware state and does not calculate thresholds again.
  const normal = await handleSensorPacket(packet({ q: 2, st: 'NORMAL', at: 50, h: 20, pm: 360 }));
  assert.equal(normal.alert.action, 'closed');
  assert.equal(closes, 1);
  assert.equal(snapshot.state, 'NORMAL');
  assert.equal(active, null);
  assert.equal(serializeReading(readings[1]).state, 'NORMAL');
  assert.equal(withOnlineStatus(snapshot).state, 'NORMAL');

  await handleSensorPacket(packet({ q: 3, st: 'SENSOR_FAULT', sh: 'FAULT', at: null, h: null }));
  assert.equal(active.level, 'SENSOR_FAULT');
  assert.equal(snapshot.state, 'SENSOR_FAULT');
  assert.equal(Object.hasOwn(snapshot, 'risk_reasons'), false);
});
