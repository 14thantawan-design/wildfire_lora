#pragma once

/*
  รับข้อมูลจาก LoRa ส่งคำสั่ง GPS ที่รออยู่ และส่งข้อมูลต่อ Backend
*/

// handleCommandAckPacket: ตรวจและจัดการ cmd_ack ที่โหนดส่งกลับสำหรับคำสั่งล่าสุด
bool handleCommandAckPacket(const String &payload) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  if (deserializeJson(doc, payload)) return false;
  if (String((const char *)(doc["t"] | "")) != "cmd_ack") return false;

  String nodeId = String((const char *)(doc["id"] | ""));
  String commandId = String((const char *)(doc["cid"] | ""));
  bool accepted = (doc["ok"] | 1) == 1;
  String reason = String((const char *)(doc["r"] | ""));
  if (!hasPendingCommandForNode(commandId, nodeId)) {
    Serial.print("Unknown command ACK ignored: ");
    Serial.println(commandId);
    LoRa.receive();
    return true;
  }

  if (acknowledgePendingCommand(commandId, nodeId, accepted, reason)) {
    clearAndRememberAcknowledgedCommand(commandId, nodeId);
    Serial.print(accepted ? "Node confirmed command: " : "Node rejected command: ");
    Serial.print(commandId);
    Serial.print(" <- ");
    Serial.print(nodeId);
    if (!accepted && reason.length() > 0) {
      Serial.print(" reason=");
      Serial.print(reason);
    }
    Serial.println();
  } else {
    Serial.print("Command ACK queue full: ");
    Serial.println(commandId);
  }

  LoRa.receive();
  return true;
}

// handleIncomingLoRa: รับหนึ่งแพ็กเก็ตแล้วส่งต่อ Backend โดยไม่ตรวจค่าภายใน
void handleIncomingLoRa() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;

  String payload;
  while (LoRa.available()) payload += (char)LoRa.read();

  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  Serial.print("RAW LoRa bytes=");
  Serial.print(packetSize);
  Serial.print(" payload=");
  Serial.println(payload);

  if (handleCommandAckPacket(payload)) return;

  // โหนดเปิดช่วงรับหลังส่งทุกครั้ง จึงส่งคำสั่ง GPS ที่ค้างอยู่ได้ทันที
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  deserializeJson(doc, payload);
  String nodeId = String((const char *)(doc["id"] | ""));
  doc["rssi"] = rssi;
  doc["snr"] = snr;
  payload = "";
  serializeJson(doc, payload);
  sendPendingCommandForNode(nodeId);
  Serial.print("Received from "); Serial.print(nodeId);
  Serial.print(" RSSI="); Serial.print(rssi);
  Serial.print(" SNR="); Serial.println(snr);

#if WIFI_HTTP_ENABLED
  postPacketToBackend(payload);
#endif
  LoRa.receive();
}
