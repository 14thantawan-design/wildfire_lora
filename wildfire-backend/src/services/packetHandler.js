const NodeModel = require('../models/Node');
const Reading = require('../models/Reading');
const { processAlertForReading } = require('./alertService');
const { evaluateRisk } = require('./riskEngine');

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
  const nodeId = packet.id;
  if (!nodeId) {
    return { ignored: true, reason: 'sensor packet missing id' };
  }

  const now = new Date();
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

  const reading = await Reading.create({
    node_id: nodeId,
    seq: toNumber(packet.q),
    timestamp: now,
    state: risk.server_state,
    confidence: nodeConfidence,
    node_state: packet.st,
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
    sensor_health: packet.sh,
    rssi,
    snr,
    raw_packet: packet
  });

  const nodeSet = {
    state: risk.server_state,
    confidence: nodeConfidence,
    node_state: packet.st,
    node_confidence: nodeConfidence,
    server_state: risk.server_state,
    server_risk_score: risk.server_risk_score,
    server_reasons: risk.server_reasons,
    fire_danger_level: risk.fire_danger_level,
    evidence: risk.evidence,
    air_temp: airTemp,
    humidity,
    smoke_raw: smokeRaw,
    sensor_health: packet.sh,
    last_seen: now,
    last_seq: toNumber(packet.q),
    online: true
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
  const nodeId = packet.id;
  if (!nodeId) {
    return { ignored: true, reason: 'gps packet missing id' };
  }

  const now = new Date();
  const gpsFixed = Number(packet.gf) === 1;
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
    setIfDefined(nodeSet, 'lat', toNumber(packet.la));
    setIfDefined(nodeSet, 'lng', toNumber(packet.ln));
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
  if (!packet || typeof packet !== 'object') {
    return { ignored: true, reason: 'invalid packet' };
  }

  if (packet.t === 's' || packet.t === 'c') {
    return handleSensorPacket(packet, meta);
  }

  if (packet.t === 'gps') {
    return handleGpsPacket(packet, meta);
  }

  return { ignored: true, reason: `unsupported packet type: ${packet.t}` };
}

module.exports = {
  handlePacket,
  handleSensorPacket,
  handleGpsPacket,
  parsePacketLine,
  parseMetaFromLine
};
