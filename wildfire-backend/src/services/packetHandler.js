const NodeModel = require('../models/Node');
const Reading = require('../models/Reading');
const { processAlertForReading } = require('./alertService');

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

  const reading = await Reading.create({
    node_id: nodeId,
    seq: toNumber(packet.q),
    timestamp: now,
    state: packet.st,
    confidence: toNumber(packet.c),
    air_temp: toNumber(packet.at),
    humidity: toNumber(packet.h),
    smoke_raw: toNumber(packet.sm),
    smoke_delta: toNumber(packet.sd),
    smoke_baseline_delta: toNumber(packet.sr),
    air_baseline_delta: toNumber(packet.ar),
    humidity_baseline_delta: toNumber(packet.hr),
    sensor_health: packet.sh,
    rssi,
    snr,
    raw_packet: packet
  });

  const nodeSet = {
    state: packet.st,
    confidence: toNumber(packet.c),
    air_temp: toNumber(packet.at),
    humidity: toNumber(packet.h),
    smoke_raw: toNumber(packet.sm),
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

  if (packet.t === 's') {
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
