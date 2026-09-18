#pragma once

/*
  การรับและตรวจแพ็กเก็ต LoRa
  แปลง JSON แสดงผล ส่ง ACK/คำสั่ง และนำข้อมูลที่ถูกต้องเข้าคิว Backend
*/

// normalizeRiskState: ปรับชื่อสถานะเป็นตัวพิมพ์ใหญ่และรับเฉพาะค่าที่ระบบรู้จัก
String normalizeRiskState(String state) {
  state.trim();
  state.toUpperCase();
  if (state == "NORMAL" || state == "WATCH" ||
      state == "WARNING" || state == "SENSOR_FAULT") return state;
  return "UNKNOWN";
}

// isGpsCoordinateValid: ตรวจช่วงละติจูดและลองจิจูดก่อนนำไปแสดงหรือส่งต่อ
bool isGpsCoordinateValid(double latitude, double longitude) {
  if (isnan(latitude) || isnan(longitude)) return false;
  if (latitude < -90.0 || latitude > 90.0) return false;
  if (longitude < -180.0 || longitude > 180.0) return false;
  if (fabs(latitude) < 0.000001 && fabs(longitude) < 0.000001) return false;
  return true;
}

// parseJsonPacket: แปลง JSON จาก LoRa เป็น ParsedPacket และตรวจฟิลด์หลักที่จำเป็น
bool parseJsonPacket(const String &payload, ParsedPacket &out) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    Serial.print("Raw packet: ");
    Serial.println(payload);
    return false;
  }

  String rawPacketType = String((const char *)(doc["t"] | ""));
  out.packetType = rawPacketType == "s" ? "sensor" : rawPacketType;
  out.nodeId = String((const char *)(doc["id"] | ""));
  out.seq = doc["q"] | 0U;
  out.sessionId = doc["sid"] | 0U;
  out.reportIntervalSec = doc["ri"] | 0U;
  out.gpsFix = (doc["gf"] | 0) == 1;
  out.latitude = doc["la"] | 0.0;
  out.longitude = doc["ln"] | 0.0;
  out.gpsError = String((const char *)(doc["er"] | ""));
  out.state = normalizeRiskState(String((const char *)(doc["st"] | "")));
  out.riskModelVersion = doc["rv"] | 0;
  out.airTemp = doc["at"].isNull() ? NAN : doc["at"].as<float>();
  out.humidity = doc["h"].isNull() ? NAN : doc["h"].as<float>();
  out.particleUgM3 = doc["pm"].isNull() ? NAN : doc["pm"].as<float>();
  out.sensorHealth = String((const char *)(doc["sh"] | ""));

  if (out.nodeId.length() == 0) {
    Serial.println("ERROR: packet missing node_id/id");
    return false;
  }
  if (out.packetType != "sensor" && out.packetType != "gps") {
    Serial.println("ERROR: unsupported packet type");
    return false;
  }
  if (out.sessionId == 0) {
    Serial.println("ERROR: packet missing session id");
    return false;
  }
  if (out.packetType == "sensor" && out.riskModelVersion != 8) {
    Serial.println("ERROR: unsupported risk model version");
    return false;
  }
  return true;
}

// printFloatOrNA: แสดงค่าทศนิยมทาง Serial หรือ N/A เมื่อไม่มีข้อมูล
void printFloatOrNA(const char *label, float value, bool available = true) {
  Serial.print(label);
  if (!available || isnan(value)) Serial.println("N/A");
  else Serial.println(value);
}

// printReceivedPacket: แสดงรายละเอียดแพ็กเก็ตที่รับจากโหนดทาง Serial Monitor
void printReceivedPacket(const ParsedPacket &packet, int rssi, float snr) {
  Serial.println("========== RECEIVED PACKET ==========");
  Serial.print("From: "); Serial.println(packet.nodeId);
  Serial.print("Packet Type: "); Serial.println(packet.packetType);
  Serial.print("Seq: "); Serial.println(packet.seq);

  if (packet.packetType == "gps") {
    Serial.print("GPS Fix: "); Serial.println(packet.gpsFix ? "YES" : "NO");
    if (packet.gpsFix && isGpsCoordinateValid(packet.latitude, packet.longitude)) {
      Serial.print("Latitude: "); Serial.println(packet.latitude, 6);
      Serial.print("Longitude: "); Serial.println(packet.longitude, 6);
    } else {
      Serial.print("GPS Error: "); Serial.println(packet.gpsError);
    }
    Serial.print("RSSI: "); Serial.println(rssi);
    Serial.print("SNR: "); Serial.println(snr);
    Serial.println("=====================================");
    return;
  }

  Serial.print("State: "); Serial.println(packet.state);
  Serial.print("Report Interval: "); Serial.print(packet.reportIntervalSec); Serial.println(" sec");
  printFloatOrNA("Air Temp: ", packet.airTemp);
  printFloatOrNA("Humidity: ", packet.humidity);
  Serial.print("Particle Estimated ug/m3: "); Serial.println(packet.particleUgM3);
  Serial.print("Sensor Health: "); Serial.println(packet.sensorHealth);
  Serial.print("RSSI: "); Serial.println(rssi);
  Serial.print("SNR: "); Serial.println(snr);
  Serial.println("=====================================");
}

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

// sendSensorUplinkAck: ส่ง rx_ack ยืนยันว่า Gateway รับข้อมูลเซนเซอร์ชุดนี้แล้ว
bool sendSensorUplinkAck(const ParsedPacket &packet) {
#if SENSOR_UPLINK_ACK_ENABLED
  if (packet.packetType != "sensor") return false;

  StaticJsonDocument<192> doc;
  doc["t"] = "rx_ack";
  doc["id"] = packet.nodeId;
  doc["q"] = packet.seq;
  doc["sid"] = packet.sessionId;
  String payload;
  serializeJson(doc, payload);

  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  bool sent = LoRa.endPacket();
  LoRa.receive();
  if (sent) {
    Serial.print("Sensor uplink ACK: ");
    Serial.print(packet.nodeId);
    Serial.print(" seq=");
    Serial.println(packet.seq);
  }
  return sent;
#else
  (void)packet;
  return false;
#endif
}

// handleIncomingLoRa: รับหนึ่งแพ็กเก็ต LoRa แยก ACK/ข้อมูล ส่งคำสั่ง และนำข้อมูลเข้าคิว Backend
void handleIncomingLoRa() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;

  String payload;
  while (LoRa.available()) payload += (char)LoRa.read();

  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

#if PRINT_RAW_PAYLOAD
  Serial.print("RAW LoRa bytes=");
  Serial.print(packetSize);
  Serial.print(" payload=");
  Serial.println(payload);
#endif

  if (handleCommandAckPacket(payload)) return;

  ParsedPacket parsed;
  if (!parseJsonPacket(payload, parsed)) {
    LoRa.receive();
    return;
  }

  // The node opens a short receive window immediately after every uplink.
  // A sensor ACK is sent first; any queued command follows in the same window.
  sendSensorUplinkAck(parsed);
  sendPendingCommandForNode(parsed.nodeId);
  printReceivedPacket(parsed, rssi, snr);

#if WIFI_HTTP_ENABLED
  if (!enqueuePacketForBackend(payload, rssi, snr)) {
    Serial.println("HTTP packet queue full; packet not forwarded");
  }
#endif
  LoRa.receive();
}
