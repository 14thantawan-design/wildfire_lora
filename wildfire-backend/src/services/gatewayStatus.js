let lastPacketAt = null;
let lastTransport = null;

function markGatewayPacket(transport) {
  lastPacketAt = new Date();
  lastTransport = transport;
}

function gatewayStatus() {
  const timeoutMs = Number(process.env.GATEWAY_OFFLINE_TIMEOUT_MS || 30000);
  const lastPacketMs = lastPacketAt ? lastPacketAt.getTime() : 0;

  return {
    connected: lastPacketMs > 0 && Date.now() - lastPacketMs <= timeoutMs,
    last_packet_at: lastPacketAt,
    transport: lastTransport,
    timeout_ms: timeoutMs
  };
}

module.exports = {
  gatewayStatus,
  markGatewayPacket
};
