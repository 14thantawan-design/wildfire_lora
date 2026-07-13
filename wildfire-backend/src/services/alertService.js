const Alert = require('../models/Alert');
const Reading = require('../models/Reading');

const ALERT_LEVELS = ['WARNING', 'CRITICAL', 'SENSOR_FAULT'];
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

function normalizeReason(reason) {
  if (reason === 'smoke_sensor_low_stuck') return 'smoke_low_stable';
  return reason;
}

function mergeReasons(...reasonLists) {
  return [...new Set(reasonLists.flat().filter(Boolean).map(normalizeReason))];
}

function buildMessage(nodeId, level, riskScore, reasons = []) {
  const reasonText = reasons.length ? `: ${reasons.slice(0, 4).join(', ')}` : '';
  return `${nodeId} entered ${level} state with server risk ${riskScore || 0}${reasonText}`;
}

function buildLastReading(reading) {
  if (!reading) return undefined;

  return {
    reading_id: reading._id,
    seq: reading.seq,
    timestamp: reading.timestamp,
    state: reading.server_state || reading.state,
    server_state: reading.server_state,
    server_risk_score: reading.server_risk_score,
    server_reasons: reading.server_reasons || [],
    fire_danger_level: reading.fire_danger_level,
    evidence: reading.evidence,
    node_state: reading.node_state,
    confidence: reading.confidence,
    node_confidence: reading.node_confidence,
    air_temp: reading.air_temp,
    humidity: reading.humidity,
    smoke_raw: reading.smoke_raw,
    smoke_delta: reading.smoke_delta,
    smoke_baseline_delta: reading.smoke_baseline_delta,
    air_baseline_delta: reading.air_baseline_delta,
    humidity_baseline_delta: reading.humidity_baseline_delta,
    sensor_health: reading.sensor_health,
    rssi: reading.rssi,
    snr: reading.snr
  };
}

async function hasCleanNormalStreak(nodeId, count = 3) {
  const recent = await Reading.find({ node_id: nodeId })
    .sort({ timestamp: -1 })
    .limit(count)
    .select('server_state state')
    .lean();

  return recent.length >= count && recent.every((reading) => (reading.server_state || reading.state) === 'NORMAL');
}

async function processAlertForReading(reading) {
  if (!reading || !reading.node_id) {
    return { action: 'ignored' };
  }

  const now = reading.timestamp || new Date();
  const nodeId = reading.node_id;
  const state = reading.server_state || reading.state;
  const confidence = reading.confidence || 0;
  const riskScore = reading.server_risk_score || 0;
  const reasons = reading.server_reasons || [];

  if (state === 'NORMAL') {
    const clean = await hasCleanNormalStreak(nodeId, 3);
    if (!clean) {
      return { action: 'clean_streak_pending' };
    }

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
      max_risk_score: riskScore,
      max_state: state,
      reasons,
      message: buildMessage(nodeId, state, riskScore, reasons),
      last_reading: lastReading
    });

    return { action: 'created', alert_id: alert._id };
  }

  const nextLevel = severityOf(state) > severityOf(activeAlert.level) ? state : activeAlert.level;
  activeAlert.level = nextLevel;
  activeAlert.max_confidence = Math.max(activeAlert.max_confidence || 0, confidence);
  activeAlert.max_risk_score = Math.max(activeAlert.max_risk_score || 0, riskScore);
  activeAlert.max_state =
    severityOf(state) > severityOf(activeAlert.max_state) ? state : activeAlert.max_state || nextLevel;
  activeAlert.reasons = mergeReasons(activeAlert.reasons || [], reasons);
  activeAlert.message = buildMessage(nodeId, nextLevel, activeAlert.max_risk_score, activeAlert.reasons);
  activeAlert.last_reading = lastReading;
  await activeAlert.save();

  return { action: 'updated', alert_id: activeAlert._id };
}

module.exports = {
  ALERT_LEVELS,
  processAlertForReading,
  severityOf
};
