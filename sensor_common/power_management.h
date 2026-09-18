#pragma once

/*
  เวลาและการประหยัดพลังงาน
  รักษารอบวัดแบบ start-to-start บริการ GPS ระหว่างรอ
  และสั่ง deep sleep เมื่อสถานะอนุญาต
*/

// delayWithBackgroundTasks: รอเป็นช่วงสั้นไม่เกิน 50 ms ระหว่างเรียกบริการ GPS; ช่วยให้อ่านข้อมูล GPS ระหว่างพักรอบได้ แต่ฟังก์ชันบริการเองอาจใช้เวลานานกว่านั้น
void delayWithBackgroundTasks(unsigned long durationMs) {
  unsigned long startMs = millis();
  while (millis() - startMs < durationMs) {
#if USE_GPS
    serviceOneShotGps();
#endif
    unsigned long elapsedMs = millis() - startMs;
    unsigned long remainingMs = (elapsedMs < durationMs) ? durationMs - elapsedMs : 0;
    delay(remainingMs > 50UL ? 50UL : remainingMs);
  }
}

// printSensorDebug: แสดงค่าที่ใช้ตัดสินและสถานะสุดท้าย
void printSensorDebug(const SensorData &data, FireStatus status) {
#if SERIAL_DEBUG
  Serial.println("========== SENSOR NODE ==========");
  Serial.print("Node: "); Serial.println(NODE_ID);
  Serial.print("State: "); Serial.println(statusToString(status));
  Serial.print("Air Temp: "); Serial.println(data.airTemp);
  Serial.print("Humidity: "); Serial.println(data.humidity);
  Serial.print("Particle ADC mV: "); Serial.println(data.particleAdcMilliVolts);
  Serial.print("Particle Estimated ug/m3: "); Serial.println(data.particleUgM3);
  Serial.print("Release Counter: "); Serial.println(releaseCounter);
  Serial.print("Sensor Health: "); Serial.println(sensorHealthString(data));
  Serial.print("Next Report Sec: "); Serial.println(plannedReportIntervalSeconds(status));
  Serial.println("=================================");
#endif
}

// remainingIntervalMs: ทำให้รอบเป็น start-to-start โดยหักเวลาที่อ่าน/ส่ง/รอ ACK ไปแล้ว
unsigned long remainingIntervalMs(FireStatus status, unsigned long cycleStartedMs) {
  uint64_t targetMs = (uint64_t)plannedReportIntervalSeconds(status) * 1000ULL;
  uint64_t elapsedMs = (uint64_t)(millis() - cycleStartedMs);
  if (elapsedMs >= targetMs) return 0;
  return (unsigned long)(targetMs - elapsedMs);
}

// enterDeepSleepForSeconds: เตรียมเวลาลอง GPS ปิดวิทยุ/ไฟเซนเซอร์ ตั้งปลุกแล้วเข้า การหลับลึก; ถ้าไม่ตั้งปลุกจะไม่ตื่นตามเวลาที่ต้องการ
void enterDeepSleepForSeconds(uint64_t sleepSec) {
#if !TEST_MODE
#if USE_GPS
  accountGpsRetryBeforeSleep(sleepSec);
#endif
  if (loraReady) LoRa.sleep();
  powerSensors(false);
  // แปลงวินาทีเป็นไมโครวินาที ใช้ ULL เพื่อรองรับจำนวนใหญ่ก่อนส่งให้ตัวตั้งปลุก
  esp_sleep_enable_timer_wakeup(sleepSec * 1000000ULL);
  esp_deep_sleep_start();
#endif
}

// enterDeepSleepByStatus: หลับเฉพาะเวลาที่เหลือของรอบ เพื่อให้วัดและส่งตามคาบเดียวกัน
void enterDeepSleepByStatus(FireStatus status, unsigned long cycleStartedMs) {
#if !TEST_MODE
  uint64_t remainingMs = remainingIntervalMs(status, cycleStartedMs);
  uint64_t remainingSec = (remainingMs + 999ULL) / 1000ULL;
  enterDeepSleepForSeconds(remainingSec > 0 ? remainingSec : 1);
#else
  (void)status;
  (void)cycleStartedMs;
#endif
}

#if USE_GPS
// serviceGpsUntilNextMeasurementOrSleep: ขณะรอ GPS ให้ปิดไฟเซนเซอร์และบริการ GPS จนถึงรอบวัดถัดไป; ถ้างานจบเร็วจะหลับเฉพาะเวลาที่เหลือแทนเริ่มนับรอบใหม่ทั้งหมด
void serviceGpsUntilNextMeasurementOrSleep(FireStatus status, unsigned long cycleStartedMs) {
#if !TEST_MODE
  const unsigned long intervalMs = plannedReportIntervalSeconds(status) * 1000UL;

  // จีพีเอสต้องให้ ESP32 ตื่นเพื่อแปลข้อมูล UART ส่วนเซนเซอร์สิ่งแวดล้อม
  // ไม่จำเป็นต้องเปิดไฟหรือส่งค่าซ้ำระหว่างรอให้หาพิกัดได้
  powerSensors(false);
  while (isOneShotGpsActive() && millis() - cycleStartedMs < intervalMs) {
    serviceOneShotGps();
    delay(50);
  }

  const unsigned long elapsedMs = millis() - cycleStartedMs;
  if (elapsedMs >= intervalMs) return;

  const uint64_t remainingMs = (uint64_t)intervalMs - elapsedMs;
  const uint64_t remainingSec = (remainingMs + 999ULL) / 1000ULL;
  enterDeepSleepForSeconds(remainingSec > 0 ? remainingSec : 1);
#else
  (void)status;
  (void)cycleStartedMs;
#endif
}
#endif
