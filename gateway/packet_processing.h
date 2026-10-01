#pragma once

// No legacy/raw-JSON radio fallback. Unknown, revoked, expired-cache, tampered,
// and replayed frames are dropped before ACK or forwarding to Backend.
void handleIncomingLoRa() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;
  uint8_t frame[FG_MAX_FRAME];
  size_t length = 0;
  while (LoRa.available()) {
    int value = LoRa.read();
    if (length >= sizeof(frame)) { while (LoRa.available()) LoRa.read(); LoRa.receive(); return; }
    frame[length++] = value;
  }
  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();
  FgFrameInfo info;
  FgGatewayDevice device;
  String payload;
  if (!acceptFgUplink(frame, length, info, device, payload)) {
    LoRa.receive();
    return;
  }
  StaticJsonDocument<MAX_JSON_SIZE> packet;
  if (deserializeJson(packet, payload)) { LoRa.receive(); return; }
  String type = String((const char *)(packet["t"] | ""));
  String nodeId = fgNodeId(info.slot);
  StaticJsonDocument<MAX_JSON_SIZE + 256> upload;
  upload["frame"] = fgBase64(frame, length);
  upload["rssi"] = rssi;
  upload["snr"] = snr;
  String body;
  serializeJson(upload, body);
  bool queued = false;
#if WIFI_HTTP_ENABLED
  queued = enqueuePacketForBackend(body);
#endif
  if (queued && (type == "s" || type == "gps")) {
    sendSecureReplyForNode(nodeId, info, device, type == "s");
  }
  if (queued && type == "cmd_ack") {
    String commandId = String((const char *)(packet["cid"] | ""));
    if (hasPendingCommandForNode(commandId, nodeId)) {
      clearAndRememberAcknowledgedCommand(commandId, nodeId);
    }
  }
  Serial.print(queued ? "Authenticated uplink queued: " : "Authenticated uplink queue full: ");
  Serial.println(nodeId);
  LoRa.receive();
}
