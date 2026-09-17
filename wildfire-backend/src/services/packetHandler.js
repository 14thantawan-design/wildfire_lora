const NodeModel = require('../models/Node');
const Reading = require('../models/Reading');
const { processAlertForReading } = require('./alertService');
const { RISK_MODEL_VERSION, riskFromPacket } = require('./nodeRisk');

const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const SENSOR_STATES = new Set([
  'NORMAL',
  'WATCH',
  'WARNING',
  'SENSOR_FAULT'
]);
const SENSOR_HEALTH_VALUES = new Set(['OK', 'FAULT']);
const SENSOR_PACKET_FIELDS = new Set([
  't', 'id', 'q', 'sid', 'ri', 'st', 'rv', 'at', 'h', 'pm', 'sh',
  'rssi', 'RSSI', 'rs', 'snr', 'SNR'
]);

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

function validateOptionalNumber(packet, key, minimum, maximum) {
  const value = packet[key];
  if (value === undefined || value === null) return null;
  if (!isFiniteNumber(value) || value < minimum || value > maximum) {
    return `${key} is out of range`;
  }
  return null;
}

function validateSensorPacket(packet) {
  if (packet.t !== 's') return 'sensor packet has invalid type';
  if (Object.keys(packet).some((key) => !SENSOR_PACKET_FIELDS.has(key))) {
    return 'sensor packet contains an unsupported field';
  }
  if (!isValidNodeId(packet.id)) return 'sensor packet has invalid id';
  if (!isValidSequence(packet.q)) return 'sensor packet has invalid sequence';
  if (!isValidSessionId(packet.sid)) return 'sensor packet has invalid session id';
  if (packet.rv !== RISK_MODEL_VERSION) return 'sensor packet has unsupported risk model version';

  const state = typeof packet.st === 'string' ? packet.st.trim().toUpperCase() : '';
  const health = typeof packet.sh === 'string' ? packet.sh.trim().toUpperCase() : '';
  if (!SENSOR_STATES.has(state)) return 'sensor packet has invalid state';
  if (!SENSOR_HEALTH_VALUES.has(health)) return 'sensor packet has invalid health';
  if ((state === 'SENSOR_FAULT') !== (health === 'FAULT')) {
    return 'sensor packet state and health disagree';
  }
  if (!Number.isInteger(packet.ri) || packet.ri < 1 || packet.ri > 86400) {
    return 'sensor packet has invalid report interval';
  }
  const hasParticleField = packet.pm !== undefined && packet.pm !== null;
  if (health !== 'FAULT' && !hasParticleField) {
    return 'sensor packet has invalid particle value';
  }
  if (hasParticleField && (!isFiniteNumber(packet.pm) || packet.pm < 0 || packet.pm > 2000)) {
    return 'sensor packet has invalid particle value';
  }

  const ranges = [
    ['at', -80, 100],
    ['h', 0, 100]
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
  if (!isValidSessionId(packet.sid)) return 'gps packet has invalid session id';
  if (packet.gf !== 0 && packet.gf !== 1) return 'gps packet has invalid fix flag';

  if (packet.gf === 1 && !isValidCoordinate(packet.la, packet.ln)) {
    return 'gps packet has invalid coordinates';
  }

  if (packet.er !== undefined && (typeof packet.er !== 'string' || packet.er.length > 64)) {
    return 'gps packet has invalid error code';
  }

  return null;
}

function readingIdentity(packet) {
  return {
    node_id: packet.id.trim(),
    session_id: packet.sid,
    seq: packet.q
  };
}

function isOutOfOrderPacket(node, packet) {
  if (!node || !isValidSessionId(packet.sid) || !isValidSequence(packet.q)) return false;
  if (!isValidSessionId(node.session_id) || !isValidSequence(node.last_seq)) return false;
  return node.session_id === packet.sid && packet.q <= node.last_seq;
}

function invalidPacket(reason) {
  return { ignored: true, invalid: true, reason };
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
  const identity = readingIdentity(packet);
  const duplicate = await Reading.findOne(identity).lean();

  if (duplicate) {
    return {
      type: 'sensor',
      node_id: nodeId,
      reading_id: duplicate._id,
      duplicate: true
    };
  }

  const currentNode = await NodeModel.findOne({ node_id: nodeId })
    .select('session_id last_seq')
    .lean();
  if (isOutOfOrderPacket(currentNode, packet)) {
    return {
      type: 'sensor',
      node_id: nodeId,
      ignored: true,
      stale: true,
      seq: packet.q
    };
  }

  const rssi = extractRssi(packet, meta);
  const snr = extractSnr(packet, meta);
  const risk = riskFromPacket(packet);
  const airTemp = packetNumber(packet, 'at');
  const humidity = packetNumber(packet, 'h');
  const particleUgM3 = packetNumber(packet, 'pm');
  const sensorHealth = packet.sh.trim().toUpperCase();

  const readingData = {
    node_id: nodeId,
    session_id: identity.session_id,
    report_interval_sec: toNumber(packet.ri),
    seq: toNumber(packet.q),
    timestamp: now,
    ...risk,
    air_temp: airTemp,
    humidity,
    particle_ug_m3: particleUgM3,
    sensor_health: sensorHealth,
    rssi,
    snr
  };
  let reading;
  try {
    reading = await Reading.create(readingData);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await Reading.findOne(identity).lean();
    return {
      type: 'sensor',
      node_id: nodeId,
      reading_id: existing?._id,
      duplicate: true
    };
  }

  const nodeSet = {
    ...risk,
    air_temp: airTemp,
    humidity,
    particle_ug_m3: particleUgM3,
    sensor_health: sensorHealth,
    last_seen: now,
    session_id: identity.session_id,
    last_seq: toNumber(packet.q),
    report_interval_sec: toNumber(packet.ri)
  };

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
  const currentNode = await NodeModel.findOne({ node_id: nodeId })
    .select('session_id last_seq')
    .lean();
  if (isOutOfOrderPacket(currentNode, packet)) {
    return {
      type: 'gps',
      node_id: nodeId,
      ignored: true,
      stale: true,
      seq: packet.q
    };
  }
  const gpsFixed = packet.gf === 1;
  const rssi = extractRssi(packet, meta);
  const snr = extractSnr(packet, meta);

  const nodeSet = {
    last_seen: now,
    session_id: isValidSessionId(packet.sid) ? packet.sid : undefined,
    last_seq: toNumber(packet.q),
    gps_fixed: gpsFixed
  };

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

  if (packet.t === 's') {
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
  validateSensorPacket,
  validateGpsPacket,
  readingIdentity,
  isOutOfOrderPacket
};
