#pragma once

/*
  กฎประเมินสถานะ
  รับค่าจาก SensorData แล้วตัดสิน NORMAL, WATCH, WARNING หรือ SENSOR_FAULT
  และเลือกรอบวัด/ส่งของแต่ละสถานะ
*/

// evaluateRawRisk: ตัดสินจากค่าปัจจุบันเท่านั้นตามเกณฑ์อ้างอิง ไม่มีคะแนนหรืออัตราการเปลี่ยนแปลง
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

// evaluateFireStatus: จุดตัดสินสถานะเพียงจุดเดียวของเฟิร์มแวร์
FireStatus evaluateFireStatus(const SensorData &data) {
  return evaluateRawRisk(data);
}

// plannedReportIntervalSeconds: รอบวัดและส่งเป็นรอบเดียวกันตามสถานะ
uint32_t plannedReportIntervalSeconds(FireStatus status) {
#if TEST_MODE
  return max(1UL, LOOP_INTERVAL_MS / 1000UL);
#else
  if (status == WATCH) return 120UL;
  if (status == WARNING) return 20UL;
  if (status == SENSOR_FAULT) return 300UL;
  return 300UL;
#endif
}
