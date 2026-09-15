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
  // Historical states are mapped at the API boundary so the current system
  // exposes only NORMAL, WATCH, WARNING, SENSOR_FAULT and UNKNOWN.
  if (state === 'CRITICAL') return 'WARNING';
  if (state === 'CALIBRATING') return 'UNKNOWN';
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
  const version = packet.rv ?? 1;
  const reasonBits = Number.isInteger(packet.rb) ? packet.rb : 0;
  const risk = {
    state: normalizeRiskState(packet.st),
    risk_reason_bits: reasonBits,
    risk_reasons: decodeRiskReasons(reasonBits),
    risk_source: 'node',
    risk_model_version: version
  };
  if (version < RISK_MODEL_VERSION) risk.risk_score = packet.c;
  return risk;
}

// Read pre-migration records without changing the database. Prefer the original
// node decision over the retired server decision when both were stored.
function normalizeNodeRisk(record) {
  const obj = record.toObject ? record.toObject() : { ...record };
  const raw = obj.raw_packet || {};
  const nodeState = obj.node_state && obj.node_state !== 'UNKNOWN' ? obj.node_state : raw.st;
  const selectedState = obj.risk_source === 'node'
    ? obj.state
    : nodeState || obj.state || obj.server_state || 'UNKNOWN';
  obj.state = normalizeRiskState(selectedState);
  obj.node_state = normalizeRiskState(nodeState || selectedState);
  const version = obj.risk_model_version ?? raw.rv ?? (nodeState ? 1 : null);
  if (version >= RISK_MODEL_VERSION) {
    delete obj.risk_score;
    delete obj.confidence;
    delete obj.node_confidence;
  } else {
    obj.risk_score = obj.risk_score ?? obj.node_confidence ?? raw.c ?? obj.confidence ?? null;
  }
  obj.risk_reason_bits = obj.risk_reason_bits ?? raw.rb ?? 0;
  obj.risk_reasons = obj.risk_reasons?.length
    ? [...obj.risk_reasons]
    : decodeRiskReasons(obj.risk_reason_bits);
  obj.risk_source = obj.risk_source || (nodeState ? 'node' : 'legacy');
  obj.risk_model_version = version;
  obj.particle_ug_m3 = obj.particle_ug_m3 ?? raw.pm;
  obj.particle_baseline_delta_ug_m3 = obj.particle_baseline_delta_ug_m3 ?? raw.pd;
  // Legacy server evidence does not describe the node's decision.
  for (const key of ['server_state', 'server_risk_score', 'server_reasons', 'fire_danger_level', 'evidence']) {
    delete obj[key];
  }
  return obj;
}

module.exports = {
  RISK_MODEL_VERSION,
  decodeRiskReasons,
  normalizeNodeRisk,
  normalizeRiskState,
  riskFromPacket
};
