#pragma once

/*
  การอ่านเซนเซอร์
  ดูแลการจ่ายไฟ SHT31/Sharp และอ่านค่าเซนเซอร์
*/

// powerSensors: รับ on=true เพื่อจ่ายไฟ หรือ false เพื่อตัดไฟผ่านขาควบคุม; จำสถานะด้วย static เพื่อไม่รอไฟนิ่งซ้ำ ถ้าขาเป็น -1 จะไม่สั่งสวิตช์
void powerSensors(bool on) {
  if (SENSOR_POWER_PIN >= 0) {
    static bool powered = false;
    if (powered == on) return;
    digitalWrite(SENSOR_POWER_PIN, on ? HIGH : LOW);
    powered = on;
    if (on) delay(SENSOR_POWER_STABILIZE_MS);
  }
}

// median3: เลือกค่ากลางจากการอ่านควันสามครั้ง
int median3(int a, int b, int c) {
  if ((a <= b && b <= c) || (c <= b && b <= a)) return b;
  if ((b <= a && a <= c) || (c <= a && a <= b)) return a;
  return c;
}

// readSharpOnce: อ่านค่า ADC ดิบของ Sharp หนึ่งครั้งตามจังหวะใน datasheet
int readSharpOnce() {
  // จังหวะอ่าน GP2Y1014: เปิดแอลอีดี รอ 280 ไมโครวินาที อ่าน ADC รอ 40 ไมโครวินาที แล้วปิดแอลอีดี
  // วงจร Sharp ส่วนมากใช้ LOW เพื่อเปิดแอลอีดี และ HIGH เพื่อปิดแอลอีดี
  digitalWrite(SHARP_LED_PIN, LOW);
  delayMicroseconds(280);
  int adc = analogRead(SHARP_ANALOG_PIN);
  delayMicroseconds(40);
  digitalWrite(SHARP_LED_PIN, HIGH);
  delayMicroseconds(9680);
  return adc;
}

// readParticleMedianAdc: อ่านควันสามครั้งและใช้ค่ากลางเพื่อลดผลของค่ากระโดดหนึ่งครั้ง
int readParticleMedianAdc() {
  int a = readSharpOnce();
  delay(5);
  int b = readSharpOnce();
  delay(5);
  int c = readSharpOnce();
  return median3(a, b, c);
}

// beginSht31: ลองเชื่อม SHT31 ที่ 0x44 ก่อน ถ้าไม่สำเร็จลอง 0x45 แล้วคืนผลสำเร็จ; ช่วยรองรับการตั้ง ที่อยู่อุปกรณ์ สองแบบ
bool beginSht31() {
  bool shtOk = sht31.begin(SHT31_I2C_ADDRESS_PRIMARY);
  if (!shtOk) {
    shtOk = sht31.begin(SHT31_I2C_ADDRESS_SECONDARY);
  }
  return shtOk;
}

// =========================
// การตั้งค่าอุปกรณ์ก่อนเริ่มใช้งาน
// =========================
// initSensors: ตั้งบัส I2C ขาจ่ายไฟ ขา LED และความละเอียด ADC ก่อนเริ่ม SHT31; ถ้าไม่ตั้งฮาร์ดแวร์ก่อน การอ่านอาจล้มเหลวหรือได้ค่าไม่ถูกต้อง
void initSensors() {
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (SENSOR_POWER_PIN >= 0) {
    pinMode(SENSOR_POWER_PIN, OUTPUT);
    powerSensors(true);
  }

  pinMode(SHARP_LED_PIN, OUTPUT);
  digitalWrite(SHARP_LED_PIN, HIGH);
  // ใช้ ADC 12 บิต ค่าดิบจึงอยู่ในช่วง 0–4095
  analogReadResolution(12);
  analogSetPinAttenuation(SHARP_ANALOG_PIN, ADC_11db);

  bool shtOk = beginSht31();

  Serial.print("SHT31 init: ");
  Serial.println(shtOk ? "OK" : "FAILED");
}

// =========================
// อ่านค่าเซนเซอร์หนึ่งรอบ
// =========================
// readSensors: อ่าน SHT31 หนึ่งครั้ง และใช้ค่ากลางจาก Sharp สามครั้ง
SensorData readSensors() {
  SensorData data;
  powerSensors(true);
  data.airTemp = sht31.readTemperature();
  data.humidity = sht31.readHumidity();
  data.particleAdc = readParticleMedianAdc();
  return data;
}
