const crypto = require('crypto');
const NodeModel = require('../models/Node');
const Reading = require('../models/Reading');
const { processAlertForReading } = require('./alertService');
const { riskFromPacket } = require('./nodeRisk');

const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const SENSOR_STATES = new Set([
  'NORMAL',
  'WATCH',
  'WARNING',
  'SENSOR_FAULT'
]);
const LEGACY_SENSOR_STATES = new Set([...SENSOR_STATES, 'CALIBRATING', 'CRITICAL']);
const SENSOR_HEALTH_VALUES = new Set(['OK', 'FAULT']);
const LEGACY_SENSOR_HEALTH_VALUES = new Set([...SENSOR_HEALTH_VALUES, 'CAL', 'CALIBRATING']);
const WARNING_REASON_MASK = 0b00000111;
const WATCH_REASON_MASK = 0b00111000;
const SENSOR_FAULT_REASON = 0b01000000;
const RECOVERY_REASON = 0b10000000;
const REPORT_INTERVAL_BY_STATE = {
  NORMAL: 300,
  WATCH: 120,
  WARNING: 20,
  SENSOR_FAULT: 300
};
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
  if (packet.rv !== undefined && (!Number.isInteger(packet.rv) || packet.rv < 1 || packet.rv > 255)) {
    return 'sensor packet has invalid risk model version';
  }
  const isResearchThresholdPacket = packet.rv >= 7;
  const allowedStates = isResearchThresholdPacket ? SENSOR_STATES : LEGACY_SENSOR_STATES;
  const allowedHealth = isResearchThresholdPacket ? SENSOR_HEALTH_VALUES : LEGACY_SENSOR_HEALTH_VALUES;
  if (isResearchThresholdPacket && packet.t !== 's') return 'sensor packet has invalid type';
  if (!allowedStates.has(state)) return 'sensor packet has invalid state';
  if (!allowedHealth.has(health)) return 'sensor packet has invalid health';
  if (isResearchThresholdPacket) {
    if (!Number.isInteger(packet.rb) || packet.rb < 0 || packet.rb > 255) {
      return 'sensor packet has invalid risk reason bits';
    }
    const reasonBits = packet.rb;
    if ((state === 'SENSOR_FAULT') !== (health === 'FAULT')) {
      return 'sensor packet state and health disagree';
    }
    if (state === 'NORMAL' && reasonBits !== 0) {
      return 'NORMAL sensor packet has invalid risk reason bits';
    }
    if (state === 'WATCH' &&
        ((reasonBits & (WARNING_REASON_MASK | SENSOR_FAULT_REASON)) !== 0 ||
         (reasonBits & (WATCH_REASON_MASK | RECOVERY_REASON)) === 0)) {
      return 'WATCH sensor packet has invalid risk reason bits';
    }
    if (state === 'WARNING' &&
        ((reasonBits & (WATCH_REASON_MASK | SENSOR_FAULT_REASON)) !== 0 ||
         (reasonBits & WARNING_REASON_MASK) === 0)) {
      return 'WARNING sensor packet has invalid risk reason bits';
    }
    if (state === 'SENSOR_FAULT' && reasonBits !== SENSOR_FAULT_REASON) {
      return 'SENSOR_FAULT packet has invalid risk reason bits';
    }
    const expectedInterval = REPORT_INTERVAL_BY_STATE[state];
    if (!isFiniteNumber(packet.ri) ||
        (packet.ri !== expectedInterval && packet.ri !== 5)) {
      return 'sensor packet has invalid report interval for state';
    }
  } else if (!isFiniteNumber(packet.c) || packet.c < 0 || packet.c > 100) {
    return 'sensor packet has invalid confidence';
  }
  const hasParticleField = packet.pm !== undefined && packet.pm !== null;
  const hasLegacySmokeField = packet.sm !== undefined && packet.sm !== null;
  if (health !== 'FAULT' && !hasParticleField && !hasLegacySmokeField) {
    return 'sensor packet has invalid particle value';
  }
  if (hasParticleField && (!isFiniteNumber(packet.pm) || packet.pm < 0 || packet.pm > 2000)) {
    return 'sensor packet has invalid particle value';
  }
  if (hasLegacySmokeField && (!isFiniteNumber(packet.sm) || packet.sm < 0 || packet.sm > 4095)) {
    return 'sensor packet has invalid legacy smoke value';
  }

  const ranges = [
    ['at', -80, 100],
    ['h', 0, 100],
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
  const nodeConfidence = toNumber(packet.c);
  const airTemp = packetNumber(packet, 'at');
  const humidity = packetNumber(packet, 'h');
  const particleUgM3 = packetNumber(packet, 'pm');
  // Read legacy fields during the staged firmware rollout; v7 does not use them.
  const smokeRaw = packetNumber(packet, 'sm');
  const sensorHealth = packet.sh.trim().toUpperCase();
  const nodeState = risk.state;

  const readingData = {
    node_id: nodeId,
    packet_id: identity.packetId,
    packet_hash: identity.packetHash,
    packet_type: packet.t,
    session_id: identity.sessionId,
    report_interval_sec: toNumber(packet.ri),
    seq: toNumber(packet.q),
    timestamp: now,
    ...risk,
    node_state: nodeState,
    air_temp: airTemp,
    humidity,
    particle_ug_m3: particleUgM3,
    smoke_raw: smokeRaw,
    sensor_health: sensorHealth,
    rssi,
    snr,
    raw_packet: packet
  };
  if (nodeConfidence !== undefined) {
    readingData.confidence = nodeConfidence;
    readingData.node_confidence = nodeConfidence;
  }

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
    ...risk,
    node_state: nodeState,
    air_temp: airTemp,
    humidity,
    particle_ug_m3: particleUgM3,
    smoke_raw: smokeRaw,
    sensor_health: sensorHealth,
    last_seen: now,
    session_id: identity.sessionId,
    last_seq: toNumber(packet.q),
    report_interval_sec: toNumber(packet.ri),
    online: true
  };
  if (nodeConfidence !== undefined) {
    nodeSet.confidence = nodeConfidence;
    nodeSet.node_confidence = nodeConfidence;
  }

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
    online: true,
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
  validateSensorPacket,
  validateGpsPacket,
  buildPacketIdentity,
  isOutOfOrderPacket
};
