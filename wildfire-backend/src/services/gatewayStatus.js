// เก็บเวลาที่ Gateway ติดต่อ Backend ล่าสุดไว้ในหน่วยความจำของ process
let lastPacketAt = null;
let lastTransport = null;

// อัปเดตเวลาและช่องทางสื่อสารทุกครั้งที่ได้รับ request จาก Gateway
function markGatewayPacket(transport) {
  lastPacketAt = new Date();
  lastTransport = transport;
}

// สรุปว่า Gateway ยังเชื่อมต่ออยู่หรือไม่จากเวลาติดต่อล่าสุด
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
