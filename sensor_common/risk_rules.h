#pragma once

/*
  กฎประเมินสถานะ
  รับค่าจาก SensorData แล้วตัดสิน NORMAL, WATCH, WARNING หรือ SENSOR_FAULT
  รวมกฎค้างสถานะก่อนลดระดับ และเลือกรอบวัด/ส่งของแต่ละสถานะ
*/

// hasSensorFault: คืน true เมื่อธงสุขภาพตัวใดตัวหนึ่งเป็น false; Sharp รุ่นนี้ตรวจเพียงช่วงแรงดัน ADC ยังตรวจสายหลุดหรือค่าค้างได้ไม่ครบ
bool hasSensorFault(const SensorData &data) {
  if (!data.shtOk) return true;
  if (!data.sharpOk) return true;
  return false;
}

// ensureRtcRiskState: ตรวจรูปแบบสถานะ RTC ให้ตรงกับเฟิร์มแวร์รุ่นปัจจุบัน
void ensureRtcRiskState() {
  bool validStatus = latchedStatusValue == NORMAL ||
                     latchedStatusValue == WATCH ||
                     latchedStatusValue == WARNING ||
                     latchedStatusValue == SENSOR_FAULT;
  if (rtcRiskStateVersion == RTC_RISK_STATE_VERSION && validStatus) return;

  rtcRiskStateVersion = RTC_RISK_STATE_VERSION;
  latchedStatusValue = NORMAL;
  releaseCounter = 0;
}

// statusSeverity: ใช้เปรียบเทียบเฉพาะสามระดับความเสี่ยง; SENSOR_FAULT แยกออกจากลำดับ
int statusSeverity(FireStatus status) {
  switch (status) {
    case NORMAL: return 0;
    case WATCH: return 1;
    case WARNING: return 2;
    default: return -1;
  }
}

// evaluateRawRisk: ตัดสินจากค่าปัจจุบันเท่านั้นตามเกณฑ์อ้างอิง ไม่มีคะแนนหรืออัตราการเปลี่ยนแปลง
FireStatus evaluateRawRisk(const SensorData &data) {
  if (hasSensorFault(data)) return SENSOR_FAULT;

  if (data.airTemp > WARNING_AIR_TEMP_GT_C ||
      data.particleUgM3 > WARNING_PARTICLE_GT_UG_M3 ||
      (data.airTemp >= HOT_DRY_MIN_AIR_TEMP_C &&
       data.humidity <= HOT_DRY_MAX_HUMIDITY_RH)) {
    return WARNING;
  }

  if (data.airTemp > NORMAL_MAX_AIR_TEMP_C ||
      data.particleUgM3 > NORMAL_MAX_PARTICLE_UG_M3 ||
      data.humidity < NORMAL_MIN_HUMIDITY_RH) {
    return WATCH;
  }

  return NORMAL;
}

// applyStateLatch: ยกระดับทันที แต่ลด WARNING/WATCH หลังค่าต่ำกว่าระดับเดิมติดต่อกัน 3 รอบ
FireStatus applyStateLatch(FireStatus raw) {
  FireStatus latched = (FireStatus)latchedStatusValue;

  if (raw == SENSOR_FAULT) {
    latchedStatusValue = SENSOR_FAULT;
    releaseCounter = 0;
    return raw;
  }

  if (latched == SENSOR_FAULT ||
      (latched != NORMAL && latched != WATCH && latched != WARNING)) {
    latchedStatusValue = raw;
    releaseCounter = 0;
    return raw;
  }

  if (statusSeverity(raw) > statusSeverity(latched)) {
    latchedStatusValue = raw;
    releaseCounter = 0;
    return raw;
  }

  if (raw == latched) {
    releaseCounter = 0;
    return raw;
  }

  if (releaseCounter < 255) releaseCounter++;
  if (releaseCounter < STATUS_RELEASE_CYCLES) return latched;

  releaseCounter = 0;
  if (latched == WARNING) {
    // แม้ค่ากลับ NORMAL แล้ว ให้ผ่าน WATCH ก่อนตามกฎฟื้นตัวที่ตกลงไว้
    latchedStatusValue = WATCH;
    return WATCH;
  }

  latchedStatusValue = NORMAL;
  return NORMAL;
}

// evaluateFireStatus: จุดตัดสินสถานะเพียงจุดเดียวของเฟิร์มแวร์
FireStatus evaluateFireStatus(const SensorData &data) {
  return applyStateLatch(evaluateRawRisk(data));
}

// sensorHealthString: สุขภาพเซนเซอร์แยกจากระดับความเสี่ยง
String sensorHealthString(const SensorData &data) {
  return hasSensorFault(data) ? "FAULT" : "OK";
}

// plannedReportIntervalSeconds: รอบวัดและส่งเป็นรอบเดียวกันตามสถานะ
uint32_t plannedReportIntervalSeconds(FireStatus status) {
#if TEST_MODE
  return max(1UL, LOOP_INTERVAL_MS / 1000UL);
#else
  if (status == WATCH) return WATCH_REPORT_INTERVAL_SEC;
  if (status == WARNING) return WARNING_REPORT_INTERVAL_SEC;
  if (status == SENSOR_FAULT) return SENSOR_FAULT_REPORT_INTERVAL_SEC;
  return NORMAL_REPORT_INTERVAL_SEC;
#endif
}
