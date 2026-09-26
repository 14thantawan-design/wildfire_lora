#pragma once

/*
  ลำดับการทำงานหลักของโหนด
  อ่านง่ายที่สุดโดยเริ่มจาก setup() → loop() → runOneMeasurementCycle()
  แล้วตามชื่อฟังก์ชันไปยังโมดูลที่รับผิดชอบ
*/

// sendMeasurement: วัดหนึ่งรอบแล้วส่งค่าที่วัดได้พร้อมสถานะทันที
void sendMeasurement(const SensorData &current, FireStatus status) {
  String payload = buildJsonPacket(current, status);
  sendLoRaPacket(payload, true);
}

// runOneMeasurementCycle: อ่าน → ตัดสินจากเกณฑ์ → ส่งทันที → รอหรือหลับจนถึงรอบถัดไป
void runOneMeasurementCycle() {
  unsigned long cycleStartedMs = millis();
  SensorData current = readSensors();
  FireStatus status = evaluateFireStatus(current);

  printSensorDebug(current, status);
  sendMeasurement(current, status);
#if USE_GPS
  serviceOneShotGps();
#endif

#if TEST_MODE
  delayWithBackgroundTasks(remainingIntervalMs(status, cycleStartedMs));
#else
  // WARNING ทำงานต่อเนื่อง วัดและส่งทุก 20 วินาที; รอบแรกถูกส่งไปแล้วด้านบนทันที
  if (status == WARNING) {
    delayWithBackgroundTasks(remainingIntervalMs(status, cycleStartedMs));
  }
#if USE_GPS
  else if (isOneShotGpsActive()) {
    serviceGpsUntilNextMeasurementOrSleep(status, cycleStartedMs);
  }
#endif
  else {
    enterDeepSleepByStatus(status, cycleStartedMs);
  }
#endif
}


// setupNode: เตรียมโหนดเมื่อ setup() ในไฟล์ .ino เรียกใช้ รวมถึงหลังตื่นจาก deep sleep
void setupNode() {
#if SERIAL_DEBUG
  Serial.begin(SERIAL_BAUD);
  delay(1000);
#endif

  disableUnusedRadios();
  randomSeed(esp_random());

  loadLastHandledCommandId();

  debugPrintln("Starting Wildfire Sensor Node...");
  debugPrintln(String("Mode: ") + (TEST_MODE ? "TEST_MODE" : "DEPLOY_MODE"));
  debugPrintln(String("Node ID: ") + NODE_ID);

  initSensors();
  loraReady = initLoRa();
#if USE_GPS
  startOneShotGpsIfNeeded();
#endif
}
