#pragma once

/*
  การอ่านเซนเซอร์
  ดูแลการจ่ายไฟ SHT31/Sharp การอ่านค่า การแปลงแรงดันเป็นค่าอนุภาค
  และการตรวจว่าค่าที่อ่านได้อยู่ในช่วงที่สมเหตุสมผลหรือไม่
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

// median3: รับจำนวนเต็มสามค่าแล้วคืนค่ากลางเมื่อเรียงลำดับ เช่น 100, 900, 110 ได้ 110; ช่วยตัดค่ากระโดดหนึ่งตัว แต่ไม่ได้กรองความผิดพลาดทุกแบบ
int median3(int a, int b, int c) {
  if ((a <= b && b <= c) || (c <= b && b <= a)) return b;
  if ((b <= a && a <= c) || (c <= a && a <= b)) return a;
  return c;
}

// readSharpOnce: อ่านแรงดัน Sharp หนึ่งครั้งเป็น mV ที่คาลิเบรตโดย ESP32 ตามจังหวะใน datasheet
int readSharpOnce() {
  // จังหวะอ่าน GP2Y1014: เปิดแอลอีดี รอ 280 ไมโครวินาที อ่าน ADC รอ 40 ไมโครวินาที แล้วปิดแอลอีดี
  // วงจร Sharp ส่วนมากใช้ LOW เพื่อเปิดแอลอีดี และ HIGH เพื่อปิดแอลอีดี
  digitalWrite(SHARP_LED_PIN, LOW);
  delayMicroseconds(280);
  int milliVolts = (int)analogReadMilliVolts(SHARP_ANALOG_PIN);
  delayMicroseconds(40);
  digitalWrite(SHARP_LED_PIN, HIGH);
  delayMicroseconds(9680);
  return milliVolts;
}

// readParticleMedianMilliVolts: อ่าน Sharp สามครั้งแล้วคืนแรงดันค่ากลาง; ช่วยตัดค่ากระโดดหนึ่งครั้ง
int readParticleMedianMilliVolts() {
  int a = readSharpOnce();
  delay(5);
  int b = readSharpOnce();
  delay(5);
  int c = readSharpOnce();
  return median3(a, b, c);
}

// particleUgM3FromMilliVolts: ชดเชยวงจรและแรงดันศูนย์ก่อนแปลงด้วย sensitivity ทั่วไปของผู้ผลิต
// ค่านี้เป็นค่าประมาณอนุภาค ไม่ใช่ PM2.5 ที่ผ่านการสอบเทียบกับเครื่องอ้างอิง
float particleUgM3FromMilliVolts(int adcMilliVolts) {
  if (adcMilliVolts < 0) return NAN;
  float sensorOutputMilliVolts = adcMilliVolts * SHARP_VOLTAGE_DIVIDER_GAIN;
  float estimated = (sensorOutputMilliVolts - SHARP_ZERO_OUTPUT_MV) /
                    SHARP_SENSITIVITY_MV_PER_UG_M3;
  return estimated > 0.0f ? estimated : 0.0f;
}

// isShtReadingSane: รับ t (องศาเซลเซียส) และ h (%RH) แล้วคืน true เมื่อไม่ใช่ NaN และอยู่ในช่วงที่ตั้งไว้; เป็นการตรวจความสมเหตุสมผล ไม่ใช่การสอบเทียบ
bool isShtReadingSane(float t, float h) {
  if (isnan(t) || isnan(h)) return false;
  if (t < SHT31_MIN_TEMP_C || t > SHT31_MAX_TEMP_C) return false;
  if (h < SHT31_MIN_HUMIDITY || h > SHT31_MAX_HUMIDITY) return false;
  return true;
}

// beginSht31: ลองเชื่อม SHT31 ที่ 0x44 ก่อน ถ้าไม่สำเร็จลอง 0x45 แล้วคืนผลสำเร็จ; ช่วยรองรับการตั้ง ที่อยู่อุปกรณ์ สองแบบ
bool beginSht31() {
  bool shtOk = sht31.begin(SHT31_I2C_ADDRESS_PRIMARY);
  activeSht31Address = SHT31_I2C_ADDRESS_PRIMARY;
  if (!shtOk) {
    shtOk = sht31.begin(SHT31_I2C_ADDRESS_SECONDARY);
    activeSht31Address = SHT31_I2C_ADDRESS_SECONDARY;
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
  // ใช้ ADC 12 บิตและ attenuation สูงสุดเพื่ออ่านแรงดัน Sharp แล้วให้ analogReadMilliVolts คาลิเบรตเป็น mV
  analogReadResolution(12);
  analogSetPinAttenuation(SHARP_ANALOG_PIN, ADC_11db);

  bool shtOk = beginSht31();

#if SERIAL_DEBUG
  Serial.print("SHT31 init: ");
  Serial.println(shtOk ? "OK" : "FAILED");
  if (shtOk) {
    Serial.print("SHT31 address: 0x");
    Serial.println(activeSht31Address, HEX);
  }
#endif
}

// =========================
// อ่านค่าและตรวจความสมเหตุสมผลของข้อมูลเซนเซอร์
// =========================
// readSensors: สร้างชุดข้อมูลใหม่ อ่าน SHT31 พร้อมลองใหม่หนึ่งครั้งถ้าผิดปกติ และอ่าน Sharp แบบมัธยฐาน; คืนทั้งค่าและธงสุขภาพ ไม่ใช้ค่าเก่าปลอมเป็นค่าใหม่
SensorData readSensors() {
  SensorData data;
  data.airTemp = NAN;
  data.humidity = NAN;
  data.particleAdcMilliVolts = -1;
  data.particleUgM3 = NAN;
  data.shtOk = false;
  data.sharpOk = false;

  powerSensors(true);

  float t = sht31.readTemperature();
  float h = sht31.readHumidity();
  if (!isShtReadingSane(t, h)) {
    beginSht31();
    delay(20);
    t = sht31.readTemperature();
    h = sht31.readHumidity();
  }

  if (isShtReadingSane(t, h)) {
    data.airTemp = t;
    data.humidity = h;
    data.shtOk = true;
  }

  int particleMilliVolts = readParticleMedianMilliVolts();
  data.particleAdcMilliVolts = particleMilliVolts;
  data.particleUgM3 = particleUgM3FromMilliVolts(particleMilliVolts);
  // ตรวจช่วงแรงดันและผลแปลงเท่านั้น; การทดสอบว่าค่าตอบสนองต่อควันจริงยังต้องทำกับฮาร์ดแวร์
  data.sharpOk = particleMilliVolts >= 0 && particleMilliVolts <= SHARP_ADC_MAX_MV &&
                 !isnan(data.particleUgM3);

  return data;
}
