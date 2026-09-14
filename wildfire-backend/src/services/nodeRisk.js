// Copy the firmware decision. No thresholds, scoring, or sensor-history analysis here.
function riskFromPacket(packet) {
  return {
    state: packet.st.trim().toUpperCase(),
    risk_score: packet.c,
    risk_source: 'node',
    risk_model_version: packet.rv ?? 1
  };
}

// Read pre-migration records without changing the database. Prefer the original
// node decision over the retired server decision when both were stored.
function normalizeNodeRisk(record) {
  const obj = record.toObject ? record.toObject() : { ...record };
  const raw = obj.raw_packet || {};
  const nodeState = obj.node_state && obj.node_state !== 'UNKNOWN' ? obj.node_state : raw.st;
  obj.state = obj.risk_source === 'node'
    ? obj.state
    : nodeState || obj.state || obj.server_state || 'UNKNOWN';
  obj.risk_score = obj.risk_score ?? obj.node_confidence ?? raw.c ?? obj.confidence ?? null;
  obj.risk_source = obj.risk_source || (nodeState ? 'node' : 'legacy');
  obj.risk_model_version = obj.risk_model_version ?? raw.rv ?? (nodeState ? 1 : null);
  // Legacy server evidence does not describe the node's decision.
  for (const key of ['server_state', 'server_risk_score', 'server_reasons', 'fire_danger_level', 'evidence']) {
    delete obj[key];
  }
  return obj;
}

module.exports = { riskFromPacket, normalizeNodeRisk };
