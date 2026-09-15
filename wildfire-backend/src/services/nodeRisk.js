const RISK_MODEL_VERSION = 7;

const REASON_BITS = [
  [1 << 0, 'temperature_above_45'],
  [1 << 1, 'particle_above_150'],
  [1 << 2, 'hot_dry_30_30'],
  [1 << 3, 'temperature_above_35'],
  [1 << 4, 'particle_above_50'],
  [1 << 5, 'humidity_below_50'],
  [1 << 6, 'sensor_fault'],
  [1 << 7, 'recovery_confirmation_pending']
];

function normalizeRiskState(value) {
  const state = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (['NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT'].includes(state)) return state;
  return 'UNKNOWN';
}

function decodeRiskReasons(reasonBits) {
  const bits = Number(reasonBits);
  if (!Number.isInteger(bits) || bits < 0 || bits > 0xffff) return [];
  return REASON_BITS.filter(([mask]) => (bits & mask) !== 0).map(([, reason]) => reason);
}

// Copy the firmware decision. The backend does not recalculate thresholds.
function riskFromPacket(packet) {
  const reasonBits = packet.rb;
  return {
    state: normalizeRiskState(packet.st),
    risk_reason_bits: reasonBits,
    risk_reasons: decodeRiskReasons(reasonBits),
    risk_model_version: RISK_MODEL_VERSION
  };
}

function normalizeNodeRisk(record) {
  const obj = record.toObject ? record.toObject() : { ...record };
  obj.state = normalizeRiskState(obj.state);
  obj.risk_reason_bits = Number.isInteger(obj.risk_reason_bits) ? obj.risk_reason_bits : 0;
  obj.risk_reasons = obj.risk_reasons?.length
    ? [...obj.risk_reasons]
    : decodeRiskReasons(obj.risk_reason_bits);
  return obj;
}

module.exports = {
  RISK_MODEL_VERSION,
  decodeRiskReasons,
  normalizeNodeRisk,
  normalizeRiskState,
  riskFromPacket
};
