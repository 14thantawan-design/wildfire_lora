const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateRisk } = require('../src/services/riskEngine');
const {
  buildPacketIdentity,
  mapBatteryPersistenceFields,
  validateGpsPacket,
  validateSensorPacket
} = require('../src/services/packetHandler');
const {
  batteryPercentFromMillivolts,
  batteryPercentFromVoltage
} = require('../src/services/battery');
const { hasDistinctNormalStreak, severityOf } = require('../src/services/alertService');
const { isTrustedAdminRequest } = require('../src/middleware/security');
const Reading = require('../src/models/Reading');
const NodeModel = require('../src/models/Node');
const { buildGpsReacquireUpdate } = require('../src/routes/nodes');
const { serializeReading } = require('../src/routes/readings');

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
  assert.equal(validateSensorPacket(validSensorPacket({ bv: 3.84 })), null);
  assert.match(validateSensorPacket({ t: 's', id: 'NODE01' }), /sequence/);
  assert.match(validateSensorPacket(validSensorPacket({ sm: 5000 })), /smoke/);
  assert.match(validateSensorPacket(validSensorPacket({ sh: 'OK', at: null })), /missing/);
  assert.match(validateSensorPacket(validSensorPacket({ bv: 0 })), /bv/);
  assert.match(validateSensorPacket(validSensorPacket({ bv: 5.1 })), /bv/);
});

test('battery percent uses the configured piecewise curve and clamps its result', () => {
  assert.equal(batteryPercentFromMillivolts(3300), 0);
  assert.equal(batteryPercentFromMillivolts(3450), 8);
  assert.equal(batteryPercentFromVoltage(3.84), 64);
  assert.equal(batteryPercentFromVoltage(3.2), 0);
  assert.equal(batteryPercentFromVoltage(4.3), 100);
  assert.equal(batteryPercentFromVoltage(undefined), undefined);
});

test('battery persistence mapping is optional and stores voltage plus estimate', () => {
  assert.deepEqual(mapBatteryPersistenceFields(validSensorPacket()), {});
  assert.deepEqual(
    mapBatteryPersistenceFields(validSensorPacket({ bv: 3.84 })),
    { battery_v: 3.84, battery_percent: 64 }
  );
  assert.ok(Reading.schema.path('battery_v'));
  assert.ok(Reading.schema.path('battery_percent'));
  assert.ok(NodeModel.schema.path('battery_v'));
  assert.ok(NodeModel.schema.path('battery_percent'));
});

test('reading API maps battery data from legacy raw packets without inventing zero', () => {
  const legacyReading = serializeReading({
    node_id: 'NODE01',
    state: 'NORMAL',
    raw_packet: { bv: 3.84 }
  });
  const oldNodeWithoutBattery = serializeReading({
    node_id: 'NODE02',
    state: 'NORMAL',
    raw_packet: {}
  });

  assert.equal(legacyReading.battery_v, 3.84);
  assert.equal(legacyReading.battery_percent, 64);
  assert.equal(Object.hasOwn(oldNodeWithoutBattery, 'battery_v'), false);
  assert.equal(Object.hasOwn(oldNodeWithoutBattery, 'battery_percent'), false);
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
