const crypto = require('crypto');
const NodeModel = require('../models/Node');
const Reading = require('../models/Reading');
const { processAlertForReading } = require('./alertService');
const { batteryPercentFromVoltage } = require('./battery');
const { evaluateRisk } = require('./riskEngine');

const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const SENSOR_STATES = new Set([
  'CALIBRATING',
  'NORMAL',
  'WATCH',
  'WARNING',
  'CRITICAL',
  'SENSOR_FAULT'
]);
const SENSOR_HEALTH_VALUES = new Set(['OK', 'CAL', 'CALIBRATING', 'FAULT']);
const LEGACY_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const LEGACY_PACKET_BUCKET_MS = 5 * 60 * 1000;

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function setIfDefined(target, key, value) {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toNullableNumber(value) {
  const parsed = toNumber(value);
  return parsed === undefined ? null : parsed;
}

function packetNumber(packet, key) {
  return Object.prototype.hasOwnProperty.call(packet, key) ? toNullableNumber(packet[key]) : undefined;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidSequence(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function isValidSessionId(value) {
  return Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}

function isValidNodeId(value) {
  return typeof value === 'string' && NODE_ID_PATTERN.test(value.trim());
}

function isValidCoordinate(latitude, longitude) {
  return isFiniteNumber(latitude) && isFiniteNumber(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180 &&
    (Math.abs(latitude) >= 0.000001 || Math.abs(longitude) >= 0.000001);
}

function mapBatteryPersistenceFields(packet) {
  const batteryV = packetNumber(packet, 'bv');
  if (!isFiniteNumber(batteryV)) return {};

  return {
    battery_v: batteryV,
    battery_percent: batteryPercentFromVoltage(batteryV)
  };
}

function validateOptionalNumber(packet, key, minimum, maximum) {
  const value = packet[key];
  if (value === undefined || value === null) return null;
  if (!isFiniteNumber(value) || value < minimum || value > maximum) {
    return `${key} is out of range`;
  }
  return null;
}

function validateSensorPacket(packet) {
  if (packet.t !== 's' && packet.t !== 'c') return 'sensor packet has invalid type';
  if (!isValidNodeId(packet.id)) return 'sensor packet has invalid id';
  if (!isValidSequence(packet.q)) return 'sensor packet has invalid sequence';
  if (packet.sid !== undefined && !isValidSessionId(packet.sid)) return 'sensor packet has invalid session id';

  const state = typeof packet.st === 'string' ? packet.st.trim().toUpperCase() : '';
  const health = typeof packet.sh === 'string' ? packet.sh.trim().toUpperCase() : '';
  if (!SENSOR_STATES.has(state)) return 'sensor packet has invalid state';
  if (!SENSOR_HEALTH_VALUES.has(health)) return 'sensor packet has invalid health';
  if (!isFiniteNumber(packet.c) || packet.c < 0 || packet.c > 100) return 'sensor packet has invalid confidence';
  if (!isFiniteNumber(packet.sm) || packet.sm < 0 || packet.sm > 4095) return 'sensor packet has invalid smoke value';

  const ranges = [
    ['at', -80, 100],
    ['h', 0, 100],
    ['sd', -4095, 4095],
    ['ad', -100, 100],
    ['hd', -100, 100],
    ['sr', -4095, 4095],
    ['ar', -100, 100],
    ['hr', -100, 100],
    ['bv', 2.5, 5.0],
    ['ri', 1, 86400]
  ];

  for (const [key, minimum, maximum] of ranges) {
    const error = validateOptionalNumber(packet, key, minimum, maximum);
    if (error) return error;
  }

  if (health !== 'FAULT' && (!isFiniteNumber(packet.at) || !isFiniteNumber(packet.h))) {
    return 'healthy sensor packet is missing temperature or humidity';
  }

  return null;
}

function validateGpsPacket(packet) {
  if (packet.t !== 'gps') return 'gps packet has invalid type';
  if (!isValidNodeId(packet.id)) return 'gps packet has invalid id';
  if (!isValidSequence(packet.q)) return 'gps packet has invalid sequence';
  if (packet.sid !== undefined && !isValidSessionId(packet.sid)) return 'gps packet has invalid session id';
  if (packet.gf !== 0 && packet.gf !== 1) return 'gps packet has invalid fix flag';

  if (packet.gf === 1 && !isValidCoordinate(packet.la, packet.ln)) {
    return 'gps packet has invalid coordinates';
  }

  const satelliteError = validateOptionalNumber(packet, 'sat', 0, 100);
  if (satelliteError) return satelliteError;
  const hdopError = validateOptionalNumber(packet, 'hd', 0, 100);
  if (hdopError) return hdopError;
  if (packet.er !== undefined && (typeof packet.er !== 'string' || packet.er.length > 64)) {
    return 'gps packet has invalid error code';
  }

  return null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .filter((key) => !['rssi', 'RSSI', 'rs', 'snr', 'SNR'].includes(key))
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

function buildPacketIdentity(packet, now = new Date()) {
  const packetHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(packet)))
    .digest('hex');
  const sessionId = isValidSessionId(packet.sid) ? packet.sid : undefined;
  const packetId = sessionId
    ? `${packet.id.trim()}:${sessionId}:${packet.q}:${packet.t}`
    : `legacy:${packetHash}:${Math.floor(now.getTime() / LEGACY_PACKET_BUCKET_MS)}`;

  return { packetHash, packetId, sessionId };
}

function invalidPacket(reason) {
  return { ignored: true, invalid: true, reason };
}

function parseMetaFromLine(line) {
  const meta = {};
  const rssiMatch = line.match(/\brssi\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  const snrMatch = line.match(/\bsnr\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);

  if (rssiMatch) meta.rssi = toNumber(rssiMatch[1]);
  if (snrMatch) meta.snr = toNumber(snrMatch[1]);

  return meta;
}

function parsePacketLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  const meta = parseMetaFromLine(trimmed);
  const payloadIndex = trimmed.indexOf('payload=');
  const candidate = payloadIndex >= 0 ? trimmed.slice(payloadIndex + 'payload='.length).trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  const jsonText = candidate.slice(firstBrace, lastBrace + 1);

  try {
    return {
      packet: JSON.parse(jsonText),
      meta
    };
  } catch (error) {
    return null;
  }
}

function extractRssi(packet, meta) {
  return toNumber(firstDefined(packet.rssi, packet.RSSI, packet.rs, meta && meta.rssi));
}

function extractSnr(packet, meta) {
  return toNumber(firstDefined(packet.snr, packet.SNR, meta && meta.snr));
}

async function handleSensorPacket(packet, meta = {}) {
  const validationError = validateSensorPacket(packet);
  if (validationError) return invalidPacket(validationError);

  const nodeId = packet.id.trim();
  const now = new Date();
  const identity = buildPacketIdentity(packet, now);
  const duplicate = await Reading.findOne({
    node_id: nodeId,
    $or: [
      { packet_id: identity.packetId },
      {
        packet_hash: identity.packetHash,
        timestamp: { $gte: new Date(now.getTime() - LEGACY_DUPLICATE_WINDOW_MS) }
      }
    ]
  }).lean();

  if (duplicate) {
    return {
      type: 'sensor',
      node_id: nodeId,
      reading_id: duplicate._id,
      duplicate: true
    };
  }

  const rssi = extractRssi(packet, meta);
  const snr = extractSnr(packet, meta);
  const recentReadings = await Reading.find({ node_id: nodeId })
    .sort({ timestamp: -1 })
    .limit(10)
    .lean();
  const history = recentReadings.reverse();
  const risk = evaluateRisk(packet, history, { timestamp: now });
  const nodeConfidence = toNumber(packet.c);
  const airTemp = packetNumber(packet, 'at');
  const humidity = packetNumber(packet, 'h');
  const smokeRaw = packetNumber(packet, 'sm');
  const smokeDelta = packetNumber(packet, 'sd');
  const smokeBaselineDelta = packetNumber(packet, 'sr');
  const airBaselineDelta = packetNumber(packet, 'ar');
  const humidityBaselineDelta = packetNumber(packet, 'hr');
  const sensorHealth = packet.sh.trim().toUpperCase();
  const nodeState = packet.st.trim().toUpperCase();
  const batteryFields = mapBatteryPersistenceFields(packet);

  const readingData = {
    node_id: nodeId,
    packet_id: identity.packetId,
    packet_hash: identity.packetHash,
    packet_type: packet.t,
    session_id: identity.sessionId,
    report_interval_sec: toNumber(packet.ri),
    seq: toNumber(packet.q),
    timestamp: now,
    state: risk.server_state,
    confidence: nodeConfidence,
    node_state: nodeState,
    node_confidence: nodeConfidence,
    server_state: risk.server_state,
    server_risk_score: risk.server_risk_score,
    server_reasons: risk.server_reasons,
    fire_danger_level: risk.fire_danger_level,
    evidence: risk.evidence,
    air_temp: airTemp,
    humidity,
    smoke_raw: smokeRaw,
    smoke_delta: smokeDelta,
    smoke_baseline_delta: smokeBaselineDelta,
    air_baseline_delta: airBaselineDelta,
    humidity_baseline_delta: humidityBaselineDelta,
    sensor_health: sensorHealth,
    rssi,
    snr,
    raw_packet: packet
  };
  Object.assign(readingData, batteryFields);

  let reading;
  try {
    reading = await Reading.create(readingData);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await Reading.findOne({ packet_id: identity.packetId }).lean();
    return {
      type: 'sensor',
      node_id: nodeId,
      reading_id: existing?._id,
      duplicate: true
    };
  }

  const nodeSet = {
    state: risk.server_state,
    confidence: nodeConfidence,
    node_state: nodeState,
    node_confidence: nodeConfidence,
    server_state: risk.server_state,
    server_risk_score: risk.server_risk_score,
    server_reasons: risk.server_reasons,
    fire_danger_level: risk.fire_danger_level,
    evidence: risk.evidence,
    air_temp: airTemp,
    humidity,
    smoke_raw: smokeRaw,
    sensor_health: sensorHealth,
    last_seen: now,
    last_seq: toNumber(packet.q),
    report_interval_sec: toNumber(packet.ri),
    online: true
  };
  Object.assign(nodeSet, batteryFields);

  setIfDefined(nodeSet, 'rssi', rssi);
  setIfDefined(nodeSet, 'snr', snr);

  await NodeModel.findOneAndUpdate(
    { node_id: nodeId },
    { $set: nodeSet, $setOnInsert: { node_id: nodeId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const alertResult = await processAlertForReading(reading);

  return {
    type: 'sensor',
    node_id: nodeId,
    reading_id: reading._id,
    risk,
    alert: alertResult
  };
}

async function handleGpsPacket(packet, meta = {}) {
  const validationError = validateGpsPacket(packet);
  if (validationError) return invalidPacket(validationError);

  const nodeId = packet.id.trim();
  const now = new Date();
  const gpsFixed = packet.gf === 1;
  const rssi = extractRssi(packet, meta);
  const snr = extractSnr(packet, meta);

  const nodeSet = {
    last_seen: now,
    last_seq: toNumber(packet.q),
    online: true,
    gps_fixed: gpsFixed
  };

  setIfDefined(nodeSet, 'gps_satellites', toNumber(packet.sat));
  setIfDefined(nodeSet, 'gps_hdop', toNumber(packet.hd));
  setIfDefined(nodeSet, 'rssi', rssi);
  setIfDefined(nodeSet, 'snr', snr);

  const update = { $set: nodeSet, $setOnInsert: { node_id: nodeId } };

  if (gpsFixed) {
    nodeSet.lat = packet.la;
    nodeSet.lng = packet.ln;
    nodeSet.location_source = 'gps';
    nodeSet.location_updated_at = now;
    update.$unset = { gps_error: '' };
  } else if (packet.er) {
    nodeSet.gps_error = packet.er;
  }

  await NodeModel.findOneAndUpdate(
    { node_id: nodeId },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    type: 'gps',
    node_id: nodeId,
    gps_fixed: gpsFixed
  };
}

async function handlePacket(packet, meta = {}) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return invalidPacket('invalid packet');
  }

  if (packet.t === 's' || packet.t === 'c') {
    return handleSensorPacket(packet, meta);
  }

  if (packet.t === 'gps') {
    return handleGpsPacket(packet, meta);
  }

  return invalidPacket(`unsupported packet type: ${packet.t}`);
}

module.exports = {
  handlePacket,
  handleSensorPacket,
  handleGpsPacket,
  parsePacketLine,
  parseMetaFromLine,
  validateSensorPacket,
  validateGpsPacket,
  buildPacketIdentity,
  mapBatteryPersistenceFields
};
