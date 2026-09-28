#pragma once

/*
  กฎประเมินสถานะ
  รับค่าจาก SensorData แล้วตัดสิน NORMAL, WATCH, WARNING หรือ SENSOR_FAULT
  และเลือกรอบวัด/ส่งของแต่ละสถานะ
*/

// evaluateRawRisk: ตัดสินระดับจากค่าที่วัดรอบนี้
FireStatus evaluateRawRisk(const SensorData &data) {
  if (data.airTemp != data.airTemp ||
      data.humidity != data.humidity ||
      data.airTemp < -20.0f || data.airTemp > 85.0f ||
      data.humidity < 0.0f || data.humidity > 100.0f ||
      data.particleAdc < 0 || data.particleAdc > 4095) {
    return SENSOR_FAULT;
  }

  if (data.airTemp > 45.0f ||
      data.particleAdc > 1100 ||
      (data.airTemp >= 30.0f && data.humidity <= 30.0f)) {
    return WARNING;
  }

  if (data.airTemp > 35.0f ||
      data.particleAdc > 300 ||
      data.humidity < 50.0f) {
    return WATCH;
  }

  return NORMAL;
}

// applyStateLatch: เพิ่มระดับทันที แต่ลดทีละระดับหลังค่าต่ำกว่าติดต่อกัน 3 รอบ
FireStatus applyStateLatch(FireStatus raw) {
  if (latchedStatusValue < NORMAL || latchedStatusValue > SENSOR_FAULT) {
    latchedStatusValue = NORMAL;
    releaseCounter = 0;
  }

  FireStatus latched = (FireStatus)latchedStatusValue;

  if (raw == SENSOR_FAULT) {
    latchedStatusValue = SENSOR_FAULT;
    releaseCounter = 0;
    return SENSOR_FAULT;
  }

  if (latched == SENSOR_FAULT) {
    latchedStatusValue = raw;
    releaseCounter = 0;
    return raw;
  }

  if (raw == WARNING || (raw == WATCH && latched == NORMAL)) {
    latchedStatusValue = raw;
    releaseCounter = 0;
    return raw;
  }

  if (raw == latched) {
    releaseCounter = 0;
    return raw;
  }

  releaseCounter++;
  if (releaseCounter < 3) return latched;

  releaseCounter = 0;
  latchedStatusValue = latched == WARNING ? WATCH : NORMAL;
  return (FireStatus)latchedStatusValue;
}

// evaluateFireStatus: จุดตัดสินสถานะเพียงจุดเดียวของเฟิร์มแวร์
FireStatus evaluateFireStatus(const SensorData &data) {
  return applyStateLatch(evaluateRawRisk(data));
}

// plannedReportIntervalSeconds: รอบวัดและส่งเป็นรอบเดียวกันตามสถานะ
uint32_t plannedReportIntervalSeconds(FireStatus status) {
  if (status == WATCH) return 120UL;
  if (status == WARNING) return 20UL;
  return 300UL;
}
