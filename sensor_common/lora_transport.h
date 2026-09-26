#pragma once

/*
  การส่งข้อมูลผ่าน LoRa
  เริ่มวิทยุ สร้าง JSON ของข้อมูลเซนเซอร์ ส่งแพ็กเก็ต
  และเปิดช่วงรับคำสั่ง GPS จาก Gateway หลังส่ง
*/

// initLoRa: ตั้ง SPI และวิทยุ LoRa แล้วคืน true ถ้าเริ่มได้; ค่าคลื่นต้องสอดคล้องกับ เกตเวย์ จึงสื่อสารกันได้
bool initLoRa() {
  lastLoRaInitAttemptMs = millis();
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    loraReady = false;
    Serial.println("LoRa init FAILED");
    return false;
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_SIGNAL_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE_DENOMINATOR);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.setTxPower(LORA_TX_POWER_DBM);
  Serial.println(
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

// buildJsonPacket: ประกอบค่าที่วัดและสถานะความเสี่ยงเป็น JSON ย่อสำหรับ LoRa
String buildJsonPacket(const SensorData &data, FireStatus status) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;

  // โหนดส่งค่าที่วัดได้และสถานะความเสี่ยง
  doc["t"] = "s";
  doc["id"] = NODE_ID;
  doc["ri"] = plannedReportIntervalSeconds(status);
  doc["st"] = statusToString(status);
  doc["at"] = data.airTemp;
  doc["h"] = data.humidity;
  doc["adc"] = data.particleAdc;

  String payload;
  serializeJson(doc, payload);
  return payload;
}

// ประกาศล่วงหน้า (ยังไม่มีตัวฟังก์ชัน) เพื่อให้ฟังก์ชันส่งด้านล่างเรียกชื่อที่นิยามทีหลังได้
void listenForGatewayCommand();

// sendLoRaPacket: สุ่มเวลารอเพื่อลดการชนกัน ส่งหนึ่งครั้ง แล้วฟังคำสั่ง GPS
bool sendLoRaPacket(const String &payload, bool useRandomDelay) {
  if (!ensureLoRaReady()) {
    Serial.println("TX skipped: LoRa is not ready");
    return false;
  }

  if (useRandomDelay) {
    long d = random(RANDOM_TX_DELAY_MIN_MS, RANDOM_TX_DELAY_MAX_MS + 1);
    Serial.print("Random TX delay ms: ");
    Serial.println(d);
    delay(d);
  }

  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  bool ok = LoRa.endPacket();
  if (ok) listenForGatewayCommand();
  else LoRa.sleep();

  Serial.print("TX bytes: ");
  Serial.println(payload.length());
  Serial.print("TX: ");
  Serial.println(payload);
  Serial.print("TX status: ");
  Serial.println(ok ? "OK" : "FAILED");
  return ok;
}
