#pragma once

/*
  การส่งข้อมูลผ่าน LoRa
  เริ่มวิทยุ สร้าง JSON ของข้อมูลเซนเซอร์ ส่งแพ็กเก็ต
  และรอ ACK จาก Gateway ตามค่าที่กำหนดไว้ใน config.h
*/

// initLoRa: ตั้ง SPI และวิทยุ LoRa แล้วคืน true ถ้าเริ่มได้; ค่าคลื่นต้องสอดคล้องกับ เกตเวย์ จึงสื่อสารกันได้
bool initLoRa() {
  lastLoRaInitAttemptMs = millis();
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    loraReady = false;
    debugPrintln("LoRa init FAILED");
    return false;
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_SIGNAL_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE_DENOMINATOR);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.setTxPower(LORA_TX_POWER_DBM);
  // เพิ่มการตรวจความผิดพลาดของแพ็กเก็ตทางวิทยุ; CRC ไม่ใช่การเข้ารหัสหรือยืนยันตัวตนผู้ส่ง
  LoRa.enableCrc();

  debugPrintln(
    String("LoRa init OK SF=") + LORA_SPREADING_FACTOR +
    " TX=" + LORA_TX_POWER_DBM + " dBm"
  );
  loraReady = true;
  return true;
}

// ensureLoRaReady: คืน true ถ้าวิทยุพร้อม มิฉะนั้นลองเริ่มใหม่เมื่อพ้นเวลารอ; ช่วยกู้การส่งหลัง เริ่มอุปกรณ์ ล้มเหลวโดยไม่ลองถี่ทุกครั้ง
bool ensureLoRaReady() {
  if (loraReady) return true;
  if (millis() - lastLoRaInitAttemptMs < LORA_INIT_RETRY_MS) return false;
  return initLoRa();
}

// addFloatOrNull: ใส่ค่าทศนิยมลง JSON ตาม key; ถ้า NaN ใช้ null เพื่อบอกว่าไม่มีข้อมูล แทนเลขศูนย์ที่อาจถูกเข้าใจว่าเป็นค่าจริง
void addFloatOrNull(JsonDocument &doc, const char *key, float value) {
  if (isnan(value)) doc[key] = nullptr;
  else doc[key] = value;
}

// buildJsonPacket: ประกอบข้อมูลวัดเป็น JSON ย่อและเพิ่ม seq หนึ่งครั้งต่อข้อมูลชุดใหม่; คีย์สั้นช่วยประหยัดพื้นที่ LoRa การส่งซ้ำใช้ ข้อความที่จะส่ง เดิมเพื่อระบุว่าเป็นชุดเดียวกัน
String buildJsonPacket(const SensorData &data, FireStatus status) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  seq++;

  // โหนดตัดสินสถานะแล้วส่งเฉพาะค่าที่วัดได้ สุขภาพเซนเซอร์ และสถานะสุดท้าย
  doc["t"] = "s";
  doc["id"] = NODE_ID;
  doc["q"] = seq;
  doc["sid"] = bootSessionId;
  doc["ri"] = plannedReportIntervalSeconds(status);
  doc["st"] = statusToString(status);
  addFloatOrNull(doc, "at", data.airTemp);
  addFloatOrNull(doc, "h", data.humidity);
  if (data.particleAdc < 0) doc["adc"] = nullptr;
  else doc["adc"] = data.particleAdc;
  doc["sh"] = sensorHealthString(data);

  String payload;
  serializeJson(doc, payload);
  return payload;
}

// ประกาศล่วงหน้า (ยังไม่มีตัวฟังก์ชัน) เพื่อให้ฟังก์ชันส่งด้านล่างเรียกชื่อที่นิยามทีหลังได้
bool listenForGatewayCommand(uint32_t expectedSeq);

// sendLoRaPacket: ส่ง ข้อความที่จะส่ง โดยอาจสุ่มเวลารอเพื่อลดโหนดส่งชนกัน แล้วเปิดหน้าต่างรับคำตอบ; คืนผลส่ง และถ้าขอ ACK ต้องได้รับ ACK ตรงชุดด้วย
bool sendLoRaPacket(const String &payload, bool useRandomDelay, bool requireGatewayAck = false) {
  if (!ensureLoRaReady()) {
    debugPrintln("TX skipped: LoRa is not ready");
    return false;
  }

  if (useRandomDelay) {
    long d = random(RANDOM_TX_DELAY_MIN_MS, RANDOM_TX_DELAY_MAX_MS + 1);
#if SERIAL_DEBUG
    Serial.print("Random TX delay ms: ");
    Serial.println(d);
#endif
    delay(d);
  }

  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  bool ok = LoRa.endPacket();
  bool acknowledged = false;
  if (ok) acknowledged = listenForGatewayCommand(seq);
  else LoRa.sleep();

#if SERIAL_DEBUG
  Serial.print("TX bytes: ");
  Serial.println(payload.length());
  Serial.print("TX: ");
  Serial.println(payload);
  Serial.print("TX status: ");
  Serial.println(ok ? "OK" : "FAILED");
  if (requireGatewayAck) {
    Serial.print("Gateway ACK: ");
    Serial.println(acknowledged ? "YES" : "NO");
  }
#endif
  return ok && (!requireGatewayAck || acknowledged);
}

// sendSensorPacketWithAck: ส่งข้อมูลเซนเซอร์ซ้ำได้ตามจำนวนที่ตั้งจนได้รับ ACK หรือหมดโอกาส; ถ้าไม่มี ACK ไม่ได้แปลว่า เกตเวย์ ไม่เคยรับ เพราะคำตอบอาจสูญหายได้เช่นกัน
bool sendSensorPacketWithAck(const String &payload) {
#if SENSOR_REQUIRE_GATEWAY_ACK
  for (int attempt = 1; attempt <= SENSOR_ACK_MAX_ATTEMPTS; attempt++) {
#if SERIAL_DEBUG
    Serial.print("Sensor TX attempt: ");
    Serial.print(attempt);
    Serial.print("/");
    Serial.println(SENSOR_ACK_MAX_ATTEMPTS);
#endif
    if (sendLoRaPacket(payload, true, true)) return true;
  }
  debugPrintln("Sensor TX ended without Gateway ACK");
  return false;
#else
  return sendLoRaPacket(payload, true);
#endif
}
