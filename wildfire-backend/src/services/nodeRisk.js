const RISK_MODEL_VERSION = 8;

function normalizeRiskState(value) {
  const state = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (['NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT'].includes(state)) return state;
  return 'UNKNOWN';
}

// Copy the firmware decision. The backend does not recalculate thresholds.
function riskFromPacket(packet) {
  return {
    state: normalizeRiskState(packet.st)
  };
}

function normalizeNodeRisk(record) {
  const obj = record.toObject ? record.toObject() : { ...record };
  obj.state = normalizeRiskState(obj.state);
  return obj;
}

module.exports = {
  RISK_MODEL_VERSION,
  normalizeNodeRisk,
  normalizeRiskState,
  riskFromPacket
};
