const Alert = require('../models/Alert');

const ALERT_LEVELS = ['WATCH', 'WARNING', 'CRITICAL', 'SENSOR_FAULT'];
const SEVERITY = {
  NORMAL: 0,
  WATCH: 1,
  WARNING: 2,
  CRITICAL: 3,
  SENSOR_FAULT: 4
};

function isAlertLevel(state) {
  return ALERT_LEVELS.includes(state);
}

function severityOf(level) {
  return SEVERITY[level] || 0;
}

function buildMessage(nodeId, level, confidence) {
  return `${nodeId} entered ${level} state with confidence ${confidence || 0}`;
}

function buildLastReading(reading) {
  if (!reading) return undefined;

  return {
    reading_id: reading._id,
    seq: reading.seq,
    timestamp: reading.timestamp,
    state: reading.state,
    confidence: reading.confidence,
    air_temp: reading.air_temp,
    humidity: reading.humidity,
    smoke_raw: reading.smoke_raw
  };
}

async function processAlertForReading(reading) {
  if (!reading || !reading.node_id || !reading.state) {
    return { action: 'ignored' };
  }

  const now = reading.timestamp || new Date();
  const nodeId = reading.node_id;
  const state = reading.state;
  const confidence = reading.confidence || 0;

  if (state === 'NORMAL') {
    const closed = await Alert.updateMany(
      { node_id: nodeId, active: true },
      { $set: { active: false, ended_at: now } }
    );
    return { action: 'closed', count: closed.modifiedCount || 0 };
  }

  if (!isAlertLevel(state)) {
    return { action: 'ignored' };
  }

  const lastReading = buildLastReading(reading);
  const activeAlert = await Alert.findOne({ node_id: nodeId, active: true }).sort({ started_at: -1 });

  if (!activeAlert) {
    const alert = await Alert.create({
      node_id: nodeId,
      level: state,
      started_at: now,
      active: true,
      max_confidence: confidence,
      message: buildMessage(nodeId, state, confidence),
      last_reading: lastReading
    });

    return { action: 'created', alert_id: alert._id };
  }

  const nextLevel = severityOf(state) > severityOf(activeAlert.level) ? state : activeAlert.level;
  activeAlert.level = nextLevel;
  activeAlert.max_confidence = Math.max(activeAlert.max_confidence || 0, confidence);
  activeAlert.message = buildMessage(nodeId, nextLevel, activeAlert.max_confidence);
  activeAlert.last_reading = lastReading;
  await activeAlert.save();

  return { action: 'updated', alert_id: activeAlert._id };
}

module.exports = {
  ALERT_LEVELS,
  processAlertForReading,
  severityOf
};
