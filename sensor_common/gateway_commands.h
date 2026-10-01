#pragma once

/*
  คำสั่งจาก Gateway
  รับคำสั่ง GPS ป้องกันคำสั่งซ้ำ
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

// sendCommandAckPacket: ส่ง cmd_ack กลับว่าโหนดยอมรับคำสั่ง GPS หรือไม่
void sendCommandAckPacket(const String &commandId, bool accepted, const String &reason) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  doc["t"] = "cmd_ack";
  doc["id"] = NODE_ID;
  doc["cid"] = commandId;
  doc["ok"] = accepted ? 1 : 0;
  if (!accepted && reason.length() > 0) doc["r"] = reason;

  String payload;
  serializeJson(doc, payload);
#if SECURE_LORA_ENABLED
  transmitSecurePayload(payload);
#else
  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  LoRa.endPacket();
#endif
}

// handleGatewayCommand: แปลง JSON ตรวจชนิด ปลายทาง รหัส และชื่อคำสั่งก่อนทำงาน; คืนรหัสคำสั่งที่รู้จักเพื่อส่งผลตอบกลับ หรือข้อความว่างเมื่อข้ามแพ็กเก็ต
String handleGatewayCommand(const String &payload) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  if (deserializeJson(doc, payload)) return "";
  String packetType = String((const char *)(doc["t"] | ""));
  if (packetType != "cmd" && packetType != "reply") return "";
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

// listenForGatewayCommand: ฟัง ACK ข้อมูลเซนเซอร์และคำสั่ง GPS หลังส่ง LoRa
bool listenForGatewayCommand(bool waitForSensorAck) {
  unsigned long startedAt = millis();
  String commandAckId;
  bool commandAccepted = true;
  String commandResultReason;
  bool sensorUplinkAcknowledged = false;
#if SECURE_LORA_ENABLED
  bool secureReplySeen = false;
#endif
  LoRa.receive();

  while (millis() - startedAt < COMMAND_RX_WINDOW_MS) {
    int packetSize = LoRa.parsePacket();
    if (!packetSize) {
      delay(2);
      continue;
    }

    String payload;
#if SECURE_LORA_ENABLED
    if (!receiveSecureReply(payload) || secureReplySeen) { LoRa.receive(); continue; }
    secureReplySeen = true;
#else
    while (LoRa.available()) payload += (char)LoRa.read();
#endif

    StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
    if (!deserializeJson(doc, payload) &&
#if SECURE_LORA_ENABLED
        String((const char *)(doc["t"] | "")) == "reply" && (doc["a"] | 0) == 1 &&
#else
        String((const char *)(doc["t"] | "")) == "rx_ack" &&
#endif
        String((const char *)(doc["id"] | "")) == NODE_ID) {
      sensorUplinkAcknowledged = waitForSensorAck;
    }
    {
      String handledCommandId = handleGatewayCommand(payload);
      if (handledCommandId.length() > 0) {
        commandAckId = handledCommandId;
        commandAccepted = lastCommandAccepted;
        commandResultReason = lastCommandResultReason;
      }
    }
    LoRa.receive();
  }

  if (commandAckId.length() > 0) {
    sendCommandAckPacket(commandAckId, commandAccepted, commandResultReason);
  }
  if (loraReady) LoRa.sleep();
  return sensorUplinkAcknowledged;
}
