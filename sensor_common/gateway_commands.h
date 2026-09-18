#pragma once

/*
  คำสั่งจาก Gateway
  รับคำสั่ง GPS ตรวจ ACK ของข้อมูลเซนเซอร์ ป้องกันคำสั่งซ้ำ
  และส่งผลตอบกลับให้ Gateway ภายในช่วงรับ LoRa
*/

// loadLastHandledCommandId: โหลดรหัสคำสั่งล่าสุดจากแฟลชเพื่อไม่ทำคำสั่งเดิมซ้ำหลังตื่น/รีเซ็ต
void loadLastHandledCommandId() {
  if (!commandPrefs.begin("node_cmd", true)) return;
  lastHandledCommandId = commandPrefs.getString("last_id", "");
  commandPrefs.end();
}

// saveLastHandledCommandId: บันทึกรหัสคำสั่งที่ทำแล้วทั้ง NVS และ RAM; ป้องกันเกตเวย์ส่งคำสั่ง GPS ซ้ำ
void saveLastHandledCommandId(const String &commandId) {
  if (!commandPrefs.begin("node_cmd", false)) return;
  commandPrefs.putString("last_id", commandId);
  commandPrefs.end();
  lastHandledCommandId = commandId;
}

// sendCommandAckPacket: ส่ง cmd_ack กลับว่าโหนดยอมรับคำสั่งหรือไม่ พร้อมเหตุผลเมื่อปฏิเสธ; ต่างจาก rx_ack ที่ เกตเวย์ ส่งยืนยันการรับข้อมูลวัด
void sendCommandAckPacket(const String &commandId, bool accepted, const String &reason) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  doc["t"] = "cmd_ack";
  doc["id"] = NODE_ID;
  doc["cid"] = commandId;
  doc["sid"] = bootSessionId;
  doc["ok"] = accepted ? 1 : 0;
  if (!accepted && reason.length() > 0) doc["r"] = reason;

  String payload;
  serializeJson(doc, payload);
  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  LoRa.endPacket();
}

// handleGatewayCommand: แปลง JSON ตรวจชนิด ปลายทาง รหัส และชื่อคำสั่งก่อนทำงาน; คืนรหัสคำสั่งที่รู้จักเพื่อส่งผลตอบกลับ หรือข้อความว่างเมื่อข้ามแพ็กเก็ต
String handleGatewayCommand(const String &payload) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  if (deserializeJson(doc, payload)) return "";
  if (String((const char *)(doc["t"] | "")) != "cmd") return "";
  if (String((const char *)(doc["id"] | "")) != NODE_ID) return "";

  String commandId = String((const char *)(doc["cid"] | ""));
  String command = String((const char *)(doc["cmd"] | ""));
  if (commandId.length() == 0 ||
      (command != "gps_reacquire" && command != "gps_manual")) return "";

  lastCommandAccepted = true;
  lastCommandResultReason = "";
  // คำสั่งรหัสเดิมตอบรับได้โดยไม่ทำงานซ้ำ; จำเฉพาะรหัสล่าสุด ไม่ใช่ประวัติคำสั่งทั้งหมด
  if (commandId == lastHandledCommandId) return commandId;

#if USE_GPS
  if (command == "gps_manual") stopGpsAndUseManualLocation();
  else startGpsReacquisition();
  saveLastHandledCommandId(commandId);
  return commandId;
#else
  return "";
#endif
}

// isUplinkAck: ตรวจ rx_ack ว่าตรง NODE_ID, bootSessionId และ seq ที่รอ; ถ้าไม่ตรวจอาจเอาคำตอบของโหนดอื่นหรือข้อมูลชุดเก่ามานับว่าสำเร็จ
bool isUplinkAck(const String &payload, uint32_t expectedSeq) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  if (deserializeJson(doc, payload)) return false;
  if (String((const char *)(doc["t"] | "")) != "rx_ack") return false;
  if (String((const char *)(doc["id"] | "")) != NODE_ID) return false;
  uint32_t ackSessionId = doc["sid"] | 0UL;
  uint32_t ackSeq = doc["q"] | 0UL;
  return ackSessionId == bootSessionId && ackSeq == expectedSeq;
}

// listenForGatewayCommand: เปิดรับ LoRa ชั่วคราวหลังส่ง แยก ACK กับคำสั่ง แล้วตอบคำสั่งล่าสุดที่จัดการได้เมื่อจบหน้าต่าง; ถ้าไม่เปิดรับจะไม่ได้ ACK/คำสั่งในช่วงนี้
bool listenForGatewayCommand(uint32_t expectedSeq) {
  unsigned long startedAt = millis();
  String commandAckId;
  bool commandAccepted = true;
  String commandResultReason;
  bool uplinkAcknowledged = false;
  LoRa.receive();

  while (millis() - startedAt < COMMAND_RX_WINDOW_MS) {
    int packetSize = LoRa.parsePacket();
    if (!packetSize) {
      delay(2);
      continue;
    }

    String payload;
    while (LoRa.available()) payload += (char)LoRa.read();
    if (isUplinkAck(payload, expectedSeq)) uplinkAcknowledged = true;
    String handledCommandId = handleGatewayCommand(payload);
    if (handledCommandId.length() > 0) {
      commandAckId = handledCommandId;
      commandAccepted = lastCommandAccepted;
      commandResultReason = lastCommandResultReason;
    }
    LoRa.receive();
  }

  if (commandAckId.length() > 0) {
    sendCommandAckPacket(commandAckId, commandAccepted, commandResultReason);
  }
  if (loraReady) LoRa.sleep();
  return uplinkAcknowledged;
}
