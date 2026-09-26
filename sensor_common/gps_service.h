#pragma once

/*
  การทำงานของ GPS
  จ่ายไฟ ค้นหาพิกัด บันทึก NVS ส่งผล GPS และจัดการการค้นใหม่
  โค้ดทั้งหมดในไฟล์นี้จะถูกคอมไพล์เฉพาะเมื่อ USE_GPS เป็น 1
*/

#if USE_GPS
// powerGps: สั่งสวิตช์จ่ายไฟ GPS และรอหนึ่งวินาทีเมื่อเปิด; GPIO ใช้คุมวงจรสวิตช์ ไม่ใช่ต่อเลี้ยง VCC โมดูลโดยตรง
void powerGps(bool on) {
  if (GPS_POWER_PIN >= 0) {
    pinMode(GPS_POWER_PIN, OUTPUT);
    digitalWrite(GPS_POWER_PIN, on ? HIGH : LOW);
    if (on) delay(1000);
  }
}

// loadGpsLocationFromNvs: อ่านพิกัดที่บันทึกไว้ใส่ พิกัดที่ค้นได้ ผ่าน การอ้างอิงข้อมูลเดิม แล้วคืนว่าใช้ได้หรือไม่; ช่วยไม่ต้องค้นดาวเทียมใหม่ทุกครั้งที่ตื่น
bool loadGpsLocationFromNvs(GpsLocation &fix) {
#if GPS_SAVE_TO_NVS
  if (GPS_FORCE_RECALIBRATE) return false;
  if (!gpsPrefs.begin("node_gps", true)) return false;

  bool storedHasFix = gpsPrefs.getBool("valid", false);
  double latitude = gpsPrefs.getDouble("lat", 0.0);
  double longitude = gpsPrefs.getDouble("lng", 0.0);
  gpsPrefs.end();

  if (!storedHasFix) return false;

  fix.latitude = latitude;
  fix.longitude = longitude;
  fix.hasFix = true;
  return true;
#else
  (void)fix;
  return false;
#endif
}

// loadGpsManualModeFromNvs: อ่านธงว่าผู้ใช้เลือกพิกัดเองหรือไม่; ถ้า true จะหยุดการค้น GPS อัตโนมัติ โดยตำแหน่งที่กรอกจัดการอยู่ฝั่งระบบปลายทาง
bool loadGpsManualModeFromNvs() {
#if GPS_SAVE_TO_NVS
  if (GPS_FORCE_RECALIBRATE) return false;
  if (!gpsPrefs.begin("node_gps", true)) return false;
  bool manualMode = gpsPrefs.getBool("manual", false);
  gpsPrefs.end();
  return manualMode;
#else
  return false;
#endif
}

// saveGpsLocationToNvs: บันทึกพิกัดที่จับได้และปิดธง กำหนดพิกัดเอง ลงแฟลช; ถ้าไม่บันทึกจะต้องหาตำแหน่งใหม่เมื่อข้อมูลใน RAM หาย
void saveGpsLocationToNvs(const GpsLocation &fix) {
#if GPS_SAVE_TO_NVS
  if (!fix.hasFix) return;
  if (!gpsPrefs.begin("node_gps", false)) return;
  gpsPrefs.putBool("manual", false);
  gpsPrefs.putBool("valid", true);
  gpsPrefs.putDouble("lat", fix.latitude);
  gpsPrefs.putDouble("lng", fix.longitude);
  gpsPrefs.end();
#else
  (void)fix;
#endif
}

// saveGpsManualModeToNvs: ล้างข้อมูล GPS เก่าแล้วจำโหมด กำหนดพิกัดเอง เพื่อให้ตื่นครั้งหน้าข้ามการค้นอัตโนมัติ
void saveGpsManualModeToNvs() {
#if GPS_SAVE_TO_NVS
  if (!gpsPrefs.begin("node_gps", false)) return;
  gpsPrefs.clear();
  gpsPrefs.putBool("manual", true);
  gpsPrefs.end();
#endif
}

// clearGpsLocationFromNvs: ล้างพื้นที่ node_gps เพื่อเลิกใช้ตำแหน่ง/โหมดเดิม; ใช้เมื่อสั่งหาพิกัดใหม่
void clearGpsLocationFromNvs() {
#if GPS_SAVE_TO_NVS
  if (!gpsPrefs.begin("node_gps", false)) return;
  gpsPrefs.clear();
  gpsPrefs.end();
#endif
}

// buildGpsPacket: สร้าง JSON GPS แยกจากข้อมูลเซนเซอร์; gf บอกว่าหาพิกัดได้หรือไม่
String buildGpsPacket(const GpsLocation &fix, bool gpsFix, const char *errorCode) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;

  doc["t"] = "gps";
  doc["id"] = NODE_ID;
  doc["gf"] = gpsFix ? 1 : 0;

  if (gpsFix && fix.hasFix) {
    doc["la"] = fix.latitude;
    doc["ln"] = fix.longitude;
  } else {
    doc["er"] = errorCode;
  }

  String payload;
  serializeJson(doc, payload);
  return payload;
}

// sendGpsLocationPackets: สร้างแพ็กเก็ตพิกัดหนึ่งชุดแล้วส่งซ้ำตาม GPS_PACKET_REPEAT_COUNT; ไม่บังคับ ACK แบบข้อมูลเซนเซอร์
void sendGpsLocationPackets(const GpsLocation &fix) {
  String payload = buildGpsPacket(fix, true, "");
  for (int i = 0; i < GPS_PACKET_REPEAT_COUNT; i++) {
    sendLoRaPacket(payload, true);
  }
}

// sendGpsFailedPacket: แจ้ง gps_failed เมื่อค้นไม่สำเร็จ; partialFix ไม่ถูกส่งเป็นพิกัด เพราะ buildGpsPacket ได้ gpsFix=false
void sendGpsFailedPacket(const GpsLocation &partialFix) {
  String payload = buildGpsPacket(partialFix, false, "gps_failed");
  sendLoRaPacket(payload, true);
}

// resetGpsLocation: ล้างพิกัดและกลับไปเป็นสถานะยังจับ GPS ไม่ได้
void resetGpsLocation(GpsLocation &fix) {
  fix.latitude = 0.0;
  fix.longitude = 0.0;
  fix.hasFix = false;
}

// stopGpsAcquisition: ปิด UART Serial2 และสั่งตัดไฟ GPS; ช่วยหยุดงานและลดพลังงานเมื่อค้นเสร็จหรือหมดเวลา
void stopGpsAcquisition() {
  Serial2.end();
  powerGps(false);
}

// stopGpsAndUseManualLocation: หยุด GPS ล้างรายงานที่รอและเวลาลองซ้ำ แล้วจำโหมด กำหนดพิกัดเอง; ไม่ได้รับละติจูด/ลองจิจูดจากคำสั่งนี้
void stopGpsAndUseManualLocation() {
  if (gpsOneShotState == GPS_ONE_SHOT_ACQUIRING) stopGpsAcquisition();
  resetGpsLocation(nodeGpsLocation);
  resetGpsLocation(gpsWorkingLocation);
  gpsFixReportPending = false;
  gpsFailureReportPending = false;
  gpsRetryRemainingSec = 0;
  gpsOneShotState = GPS_ONE_SHOT_DONE;
  saveGpsManualModeToNvs();

#if SERIAL_DEBUG
  Serial.println("Manual location accepted; automatic GPS search disabled");
#endif
}

// startGpsAcquisition: ล้างตัวแปล GPS เปิดไฟและ UART ตั้งเวลาเริ่มแล้วเข้าสถานะ ACQUIRING; การอ่านต่อทำโดย serviceOneShotGps
void startGpsAcquisition() {
  resetGpsLocation(gpsWorkingLocation);
  gps = TinyGPSPlus();
  powerGps(true);
  Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  gpsStartMs = millis();
  gpsLastAttemptMs = gpsStartMs;
  gpsRetryRemainingSec = 0;
  gpsLastDebugMs = 0;
  gpsByteCount = 0;
  gpsOneShotState = GPS_ONE_SHOT_ACQUIRING;

#if SERIAL_DEBUG
  Serial.println("GPS one-shot: acquisition started in background");
#endif
}

// startGpsReacquisition: ทิ้งพิกัดเดิมทั้ง RAM/NVS แล้วเริ่มค้นใหม่เมื่อรับคำสั่ง; ใช้หลังย้ายจุดติดตั้ง
void startGpsReacquisition() {
  if (gpsOneShotState == GPS_ONE_SHOT_ACQUIRING) stopGpsAcquisition();

  resetGpsLocation(nodeGpsLocation);
  resetGpsLocation(gpsWorkingLocation);
  clearGpsLocationFromNvs();
  gpsFixReportPending = false;
  gpsFailureReportPending = false;
  gpsOneShotState = GPS_ONE_SHOT_IDLE;
  startGpsAcquisition();

#if SERIAL_DEBUG
  Serial.println("GPS re-acquire command accepted");
#endif
}

// sendPendingGpsReports: ส่งรายงาน GPS ที่ปักธงรอไว้ แล้วล้างธง; โค้ดนี้ไม่ได้เก็บรายงานรอส่งใหม่เมื่อการส่งล้มเหลว
void sendPendingGpsReports() {
  if (gpsFixReportPending) {
    gpsFixReportPending = false;
    sendGpsLocationPackets(nodeGpsLocation);
  }

  if (gpsFailureReportPending) {
    gpsFailureReportPending = false;
    sendGpsFailedPacket(gpsWorkingLocation);
  }
}

// serviceOneShotGps: อ่าน GPS จนได้พิกัดหรือหมดเวลา; เมื่อสำเร็จจะบันทึกพิกัดแล้วหยุด GPS
void serviceOneShotGps() {
  sendPendingGpsReports();

  if (gpsOneShotState == GPS_ONE_SHOT_FAILED && !nodeGpsLocation.hasFix) {
    uint64_t retryWaitMs = (uint64_t)gpsRetryRemainingSec * 1000ULL;
    if (gpsRetryRemainingSec == 0 || (uint64_t)(millis() - gpsLastAttemptMs) >= retryWaitMs) {
      startGpsAcquisition();
    }
  }

  if (gpsOneShotState != GPS_ONE_SHOT_ACQUIRING) return;

  while (Serial2.available() > 0) {
    gps.encode((char)Serial2.read());
    gpsByteCount++;
  }

  // รับทันทีเมื่อ GPS ส่งพิกัดใหม่ที่อ่านได้ โดยไม่กรองจำนวนดาวเทียมหรือความแม่นยำ
  if (gps.location.isValid() && gps.location.isUpdated()) {
    gpsWorkingLocation.latitude = gps.location.lat();
    gpsWorkingLocation.longitude = gps.location.lng();
    gpsWorkingLocation.hasFix = true;
    nodeGpsLocation = gpsWorkingLocation;
    saveGpsLocationToNvs(nodeGpsLocation);
    stopGpsAcquisition();
    gpsOneShotState = GPS_ONE_SHOT_DONE;
    gpsFixReportPending = true;

#if SERIAL_DEBUG
    Serial.println("GPS one-shot: fix acquired and saved");
#endif
    return;
  }

  if (millis() - gpsStartMs >= GPS_FIX_TIMEOUT_MS) {
    stopGpsAcquisition();
    gpsOneShotState = GPS_ONE_SHOT_FAILED;
    gpsFailureReportPending = true;
    gpsLastAttemptMs = millis();
    gpsRetryRemainingSec = max(1UL, GPS_RETRY_INTERVAL_MS / 1000UL);

#if SERIAL_DEBUG
    Serial.println("GPS one-shot: gps_failed, continuing sensor loop");
#endif
    return;
  }

#if SERIAL_DEBUG
  if (millis() - gpsLastDebugMs > 10000UL) {
    gpsLastDebugMs = millis();
    Serial.print("GPS waiting, bytes=");
    Serial.print(gpsByteCount);
    Serial.print(" elapsed_sec=");
    Serial.println((millis() - gpsStartMs) / 1000UL);
  }
#endif
}

// startOneShotGpsIfNeeded: เลือกตอนเริ่มเครื่องว่าจะใช้โหมด กำหนดพิกัดเอง พิกัดที่บันทึก รอรอบ การลองใหม่ หรือเริ่มค้นใหม่; ถ้าไม่มีทางเลือกนี้จะเสียเวลาค้นซ้ำทุกครั้ง
void startOneShotGpsIfNeeded() {
  if (!USE_GPS) return;

  if (loadGpsManualModeFromNvs()) {
    gpsOneShotState = GPS_ONE_SHOT_DONE;
#if SERIAL_DEBUG
    Serial.println("GPS one-shot: manual location mode, automatic search skipped");
#endif
    return;
  }

  GpsLocation fix;
  if (loadGpsLocationFromNvs(fix)) {
    nodeGpsLocation = fix;
    gpsOneShotState = GPS_ONE_SHOT_DONE;
    gpsFixReportPending = true;
#if SERIAL_DEBUG
    Serial.println("GPS one-shot: using stored NVS location");
#endif
    return;
  }

  if (gpsRetryRemainingSec > 0) {
    resetGpsLocation(nodeGpsLocation);
    resetGpsLocation(gpsWorkingLocation);
    gpsOneShotState = GPS_ONE_SHOT_FAILED;
    gpsLastAttemptMs = millis();
#if SERIAL_DEBUG
    Serial.print("GPS one-shot: retry deferred for ");
    Serial.print(gpsRetryRemainingSec);
    Serial.println(" sec");
#endif
    return;
  }

  startGpsAcquisition();
}

// accountGpsRetryBeforeSleep: หักเวลาที่ตื่นและเวลาที่กำลังจะหลับออกจากรอบ การลองใหม่ แล้วเก็บใน RTC; จำเป็นเพราะ millis เริ่มนับใหม่หลัง การหลับลึก
void accountGpsRetryBeforeSleep(uint64_t sleepSec) {
  if (gpsOneShotState != GPS_ONE_SHOT_FAILED || gpsRetryRemainingSec == 0) return;

  uint32_t awakeSec = (millis() - gpsLastAttemptMs) / 1000UL;
  uint64_t elapsedSec = (uint64_t)awakeSec + sleepSec;
  if (elapsedSec >= gpsRetryRemainingSec) gpsRetryRemainingSec = 0;
  else gpsRetryRemainingSec -= (uint32_t)elapsedSec;
}

// isOneShotGpsActive: คืน true เมื่อกำลังค้นหรือมีรายงาน GPS รอส่ง; ใช้ตัดสินว่าควรตื่นบริการงานต่อก่อนหลับหรือไม่
bool isOneShotGpsActive() {
  return gpsOneShotState == GPS_ONE_SHOT_ACQUIRING ||
         gpsFixReportPending ||
         gpsFailureReportPending;
}
#endif
