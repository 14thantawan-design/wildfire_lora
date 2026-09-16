/*
  คู่มืออ่านโค้ดโหนดสำหรับผู้เริ่มต้น
  หน้าที่: อ่านอุณหภูมิ/ความชื้น SHT31 และอนุภาค Sharp ประเมินสถานะ แล้วส่ง LoRa ไป เกตเวย์
  เริ่มอ่านจาก setup() → loop() → runOneMeasurementCycle() ที่ท้ายไฟล์ แล้วตามชื่อฟังก์ชันขึ้นมา
  config.h เป็นค่าตั้งต้น เช่น ขาอุปกรณ์ เกณฑ์เตือน และเวลาหลับ ส่วนไฟล์นี้เป็นขั้นตอนทำงาน

  พื้นฐานภาษา:
  - // และข้อความในคอมเมนต์มีไว้ให้อ่าน ไม่ใช่คำสั่งที่บอร์ดทำงาน
  - #include นำประกาศจากไลบรารีเข้ามา; #if/#else/#endif เลือกโค้ดตอนคอมไพล์ก่อนอัปโหลด
  - ฟังก์ชันคือชุดคำสั่งที่เรียกตามชื่อ; (...) รับข้อมูลเข้า; {...} เป็นขอบเขตคำสั่ง
  - void คือไม่คืนค่า; return จบฟังก์ชันและอาจส่งค่ากลับ; bool มี true/false
  - int/long คือจำนวนเต็ม; float/double คือทศนิยม; String คือข้อความ; unsigned ไม่มีค่าติดลบ
  - uint8_t/uint16_t/uint32_t/uint64_t คือจำนวนเต็มไม่มีเครื่องหมายขนาด 8/16/32/64 บิต
  - const คือห้ามแก้ผ่านตัวแปรนั้น; & ในพารามิเตอร์คืออ้างถึงข้อมูลเดิม ไม่คัดลอกทั้งชุด
  - = กำหนดค่า, == เปรียบเทียบ, != ไม่เท่ากับ, && ต้องจริงทั้งคู่, || จริงอย่างน้อยหนึ่ง, ! กลับค่าจริง/เท็จ
  - += สะสมค่า, ++ เพิ่มหนึ่ง, เงื่อนไข ? ค่าถ้าจริง : ค่าถ้าเท็จ คือการเลือกค่าหนึ่งจากสองทาง
  - if/else เลือกทางทำงาน; for/while ทำซ้ำ; switch/case เลือกตามค่าที่ตรง; ; จบคำสั่ง
  - data.airTemp คืออ่านสมาชิก airTemp ของชุด data; doc["id"] คือช่องชื่อ id ใน JSON
  - NAN คือไม่มีค่าตัวเลขที่ใช้ได้; isnan ตรวจ NAN; nullptr ใน JSON ใช้บอกว่าไม่มีข้อมูล
  - millis() คือเวลาหลังเริ่มเครื่องเป็น ms; delay รอ ms; 1 วินาที = 1000 ms = 1000000 us
  - 0.05f เป็น float; UL/ULL กำหนดชนิดจำนวนเต็มให้รองรับค่ามาก เช่นเวลาเป็นไมโครวินาที

  RTC_DATA_ATTR เก็บข้าม การหลับลึก ได้ แต่ไม่ใช่ข้อมูลถาวรเมื่อไฟดับ; NVS คือพื้นที่แฟลชที่เก็บข้ามไฟดับ
  ACK คือคำตอบยืนยันรับแพ็กเก็ต ไม่ได้ยืนยันว่าข้อมูลถูกบันทึกขึ้นเว็บสำเร็จแล้ว
  คอมเมนต์ "ถ้าไม่มี" หมายถึงผลเมื่อข้ามหน้าที่นั้น; ถ้าลบฟังก์ชันแต่ยังเรียกชื่อเดิม จะคอมไพล์ไม่ผ่าน
*/


#include <Arduino.h> // คำสั่งหลัก Arduino เช่น pinMode, digitalWrite, millis และ Serial
#include <Wire.h> // บัส I2C สำหรับคุยกับ SHT31
#include <SPI.h> // บัส SPI สำหรับคุยกับชิป LoRa
#include <LoRa.h> // คำสั่งตั้งคลื่น ส่ง และรับแพ็กเก็ต LoRa
#include <ArduinoJson.h> // แปลงข้อมูลเป็น/จากข้อความ JSON
#include <Adafruit_SHT31.h> // ตัวขับเซนเซอร์อุณหภูมิและความชื้น SHT31
#include <WiFi.h> // ใช้คำสั่งปิด Wi-Fi เพื่อประหยัดไฟ
#include <Preferences.h> // อ่าน/เขียนข้อมูลถาวร NVS บน ESP32
#include "esp_system.h" // ฟังก์ชันระบบ ESP32 เช่น esp_random
#include "config.h" // ค่าตั้งต้นของโหนดนี้ ดูคำอธิบายแต่ละค่าในไฟล์นั้น

#if USE_GPS
  #include <TinyGPSPlus.h> // แปลข้อมูลข้อความจากโมดูล GPS
#endif

#if defined(BLUETOOTH_ENABLED) || defined(CONFIG_BT_ENABLED)
  #include "esp_bt.h" // ประกาศฟังก์ชัน Bluetooth เฉพาะเมื่อเปิดการรองรับในชุดคอมไพล์
#endif

// =========================
// โครงสร้างข้อมูล
// =========================
// สถานะความเสี่ยงมี 3 ระดับ; SENSOR_FAULT เป็นสุขภาพอุปกรณ์ ไม่ใช่ระดับความเสี่ยง
enum FireStatus {
  SENSOR_FAULT,
  NORMAL,
  WATCH,
  WARNING
};

// struct รวมค่าที่อ่านหนึ่งรอบ: ค่าอนุภาคเป็นค่าประมาณ µg/m³ ส่วนแรงดัน ADC เก็บไว้ตรวจใน Serial เท่านั้น
struct SensorData {
  float airTemp;
  float humidity;
  int particleAdcMilliVolts;
  float particleUgM3;
  bool shtOk;
  bool sharpOk;
};

// เก็บพิกัดและบอกตรง ๆ ว่า GPS จับตำแหน่งได้แล้วหรือยัง
struct GpsLocation {
  double latitude;
  double longitude;
  bool hasFix;
};

// =========================
// ออบเจ็กต์และตัวแปรที่ใช้ร่วมกันในไฟล์
// =========================
// ออบเจ็กต์สำหรับสั่งเซนเซอร์ผ่านไลบรารี; activeSht31Address จำ ที่อยู่อุปกรณ์ ที่เชื่อมสำเร็จเพื่อ การตรวจหาปัญหา
Adafruit_SHT31 sht31 = Adafruit_SHT31();
uint8_t activeSht31Address = SHT31_I2C_ADDRESS_PRIMARY;

#if USE_GPS
// ตัวแปลข้อความจาก GPS ทาง UART; gpsPrefs จัดการข้อมูล GPS ใน NVS เมื่อเปิดตัวเลือกบันทึก
TinyGPSPlus gps;
#if GPS_SAVE_TO_NVS
Preferences gpsPrefs;
#endif
// nodeGpsLocation คือพิกัดที่นำไปใช้ ส่วน gpsWorkingLocation เป็นพื้นที่ทำงานระหว่างค้น
GpsLocation nodeGpsLocation = {0.0, 0.0, false};
GpsLocation gpsWorkingLocation = {0.0, 0.0, false};
// สถานะค้น GPS: ยังไม่เริ่ม / กำลังค้น / จบแล้ว / ล้มเหลว; ใช้แบ่งงานเป็นช่วง ไม่ค้นค้างอยู่ใน setup
enum GpsOneShotState {
  GPS_ONE_SHOT_IDLE,
  GPS_ONE_SHOT_ACQUIRING,
  GPS_ONE_SHOT_DONE,
  GPS_ONE_SHOT_FAILED
};
GpsOneShotState gpsOneShotState = GPS_ONE_SHOT_IDLE;
// กลุ่มเวลาของ GPS: เริ่มค้น, พิมพ์ การตรวจหาปัญหา ล่าสุด, เริ่มรอ การลองใหม่; gpsRetryRemainingSec อยู่ RTC เพื่อไม่ลืมเวลารอเมื่อหลับ
unsigned long gpsStartMs = 0;
unsigned long gpsLastDebugMs = 0;
unsigned long gpsLastAttemptMs = 0;
RTC_DATA_ATTR uint32_t gpsRetryRemainingSec = 0;
uint32_t gpsByteCount = 0;
// ธงรายงานที่รอส่ง: ได้พิกัดหรือค้นล้มเหลว; ทำให้บริการรอบถัดไปรู้ว่ายังมีงาน
bool gpsFixReportPending = false;
bool gpsFailureReportPending = false;
#endif
// จำคำสั่งล่าสุดใน NVS เพื่อป้องกันการทำคำสั่ง GPS ซ้ำ
String lastHandledCommandId;
Preferences commandPrefs;
unsigned long lastLoRaInitAttemptMs = 0;
bool loraReady = false;
bool lastCommandAccepted = true;
String lastCommandResultReason;

// seq คือเลขชุดข้อมูล และ bootSessionId แยกชุดหลังเริ่มเครื่องใหม่
RTC_DATA_ATTR uint32_t seq = 0;
RTC_DATA_ATTR uint32_t bootSessionId = 0;

// จำสถานะและจำนวนรอบลดระดับข้าม deep sleep
RTC_DATA_ATTR uint32_t rtcRiskStateVersion = 0;
RTC_DATA_ATTR int latchedStatusValue = NORMAL;
RTC_DATA_ATTR uint8_t releaseCounter = 0;

// =========================
// ฟังก์ชันช่วยทำงานทั่วไป
// =========================
// statusToString: แปลงสถานะชนิด FireStatus เป็นข้อความสำหรับ JSON และหน้าจอ การตรวจหาปัญหา; ถ้าไม่มี ตัวเรียกจะไม่มีตัวแปลงชื่อสถานะ
const char* statusToString(FireStatus status) {
  switch (status) {
    case SENSOR_FAULT: return "SENSOR_FAULT";
    case NORMAL: return "NORMAL";
    case WATCH: return "WATCH";
    case WARNING: return "WARNING";
    default: return "UNKNOWN";
  }
}

// debugPrintln: พิมพ์ข้อความ msg เมื่อเปิด SERIAL_DEBUG เท่านั้น; เป็นเครื่องมือดูอาการ ไม่ได้ใช้ตัดสินไฟ
void debugPrintln(const String &msg) {
#if SERIAL_DEBUG
  Serial.println(msg);
#endif
}

// disableUnusedRadios: ปิด Wi-Fi และ Bluetooth ที่โหนดไม่ได้ใช้ เพื่อลดการใช้พลังงาน; การส่งข้อมูลส่วนนี้ใช้ LoRa
void disableUnusedRadios() {
  WiFi.mode(WIFI_OFF);
  btStop();
}

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

// addFloatOrNull: ใส่ค่าทศนิยมลง JSON ตาม key; ถ้า NaN ใช้ null เพื่อบอกว่าไม่มีข้อมูล แทนเลขศูนย์ที่อาจถูกเข้าใจว่าเป็นค่าจริง
void addFloatOrNull(JsonDocument &doc, const char *key, float value) {
  if (isnan(value)) doc[key] = nullptr;
  else doc[key] = value;
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
  doc["rv"] = RISK_MODEL_VERSION;
  addFloatOrNull(doc, "at", data.airTemp);
  addFloatOrNull(doc, "h", data.humidity);
  addFloatOrNull(doc, "pm", data.particleUgM3);
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

// buildGpsPacket: สร้าง JSON GPS แยกจากข้อมูลเซนเซอร์ พร้อมหมายเลขชุด; gf บอกว่าหาพิกัดได้หรือไม่ la/ln เป็นพิกัด ส่วน er เป็นเหตุขัดข้อง
String buildGpsPacket(const GpsLocation &fix, bool gpsFix, const char *errorCode) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  seq++;

  doc["t"] = "gps";
  doc["id"] = NODE_ID;
  doc["q"] = seq;
  doc["sid"] = bootSessionId;
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

// loadLastHandledCommandId: โหลดรหัสคำสั่งล่าสุดจากแฟลชเพื่อไม่ทำคำสั่งเดิมซ้ำหลังตื่น/รีเซ็ต
void loadLastHandledCommandId() {
  if (!commandPrefs.begin("node_cmd", true)) return;
  lastHandledCommandId = commandPrefs.getString("last_id", "");
  commandPrefs.end();
}

// saveLastHandledCommandId: บันทึกรหัสคำสั่งที่ทำแล้วทั้ง NVS และ RAM; ป้องกันเกตเวย์ส่งคำสั่ง GPS ซ้ำ
void saveLastHandledCommandId(const String &commandId) {
  if (!commandPrefs.begin("node_cmd", false)) return;
  commandPrefs.putString("last_id", commandId);
  commandPrefs.end();
  lastHandledCommandId = commandId;
}

// sendCommandAckPacket: ส่ง cmd_ack กลับว่าโหนดยอมรับคำสั่งหรือไม่ พร้อมเหตุผลเมื่อปฏิเสธ; ต่างจาก rx_ack ที่ เกตเวย์ ส่งยืนยันการรับข้อมูลวัด
void sendCommandAckPacket(const String &commandId, bool accepted, const String &reason) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  doc["t"] = "cmd_ack";
  doc["id"] = NODE_ID;
  doc["cid"] = commandId;
  doc["sid"] = bootSessionId;
  doc["ok"] = accepted ? 1 : 0;
  if (!accepted && reason.length() > 0) doc["r"] = reason;

  String payload;
  serializeJson(doc, payload);
  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  LoRa.endPacket();
}

// handleGatewayCommand: แปลง JSON ตรวจชนิด ปลายทาง รหัส และชื่อคำสั่งก่อนทำงาน; คืนรหัสคำสั่งที่รู้จักเพื่อส่งผลตอบกลับ หรือข้อความว่างเมื่อข้ามแพ็กเก็ต
String handleGatewayCommand(const String &payload) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  if (deserializeJson(doc, payload)) return "";
  if (String((const char *)(doc["t"] | "")) != "cmd") return "";
  if (String((const char *)(doc["id"] | "")) != NODE_ID) return "";

  String commandId = String((const char *)(doc["cid"] | ""));
  String command = String((const char *)(doc["cmd"] | ""));
  if (commandId.length() == 0 ||
      (command != "gps_reacquire" && command != "gps_manual")) return "";

  lastCommandAccepted = true;
  lastCommandResultReason = "";
  // คำสั่งรหัสเดิมตอบรับได้โดยไม่ทำงานซ้ำ; จำเฉพาะรหัสล่าสุด ไม่ใช่ประวัติคำสั่งทั้งหมด
  if (commandId == lastHandledCommandId) return commandId;

#if USE_GPS
  if (command == "gps_manual") stopGpsAndUseManualLocation();
  else startGpsReacquisition();
  saveLastHandledCommandId(commandId);
  return commandId;
#else
  return "";
#endif
}

// isUplinkAck: ตรวจ rx_ack ว่าตรง NODE_ID, bootSessionId และ seq ที่รอ; ถ้าไม่ตรวจอาจเอาคำตอบของโหนดอื่นหรือข้อมูลชุดเก่ามานับว่าสำเร็จ
bool isUplinkAck(const String &payload, uint32_t expectedSeq) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  if (deserializeJson(doc, payload)) return false;
  if (String((const char *)(doc["t"] | "")) != "rx_ack") return false;
  if (String((const char *)(doc["id"] | "")) != NODE_ID) return false;
  uint32_t ackSessionId = doc["sid"] | 0UL;
  uint32_t ackSeq = doc["q"] | 0UL;
  return ackSessionId == bootSessionId && ackSeq == expectedSeq;
}

// listenForGatewayCommand: เปิดรับ LoRa ชั่วคราวหลังส่ง แยก ACK กับคำสั่ง แล้วตอบคำสั่งล่าสุดที่จัดการได้เมื่อจบหน้าต่าง; ถ้าไม่เปิดรับจะไม่ได้ ACK/คำสั่งในช่วงนี้
bool listenForGatewayCommand(uint32_t expectedSeq) {
  unsigned long startedAt = millis();
  String commandAckId;
  bool commandAccepted = true;
  String commandResultReason;
  bool uplinkAcknowledged = false;
  LoRa.receive();

  while (millis() - startedAt < COMMAND_RX_WINDOW_MS) {
    int packetSize = LoRa.parsePacket();
    if (!packetSize) {
      delay(2);
      continue;
    }

    String payload;
    while (LoRa.available()) payload += (char)LoRa.read();
    if (isUplinkAck(payload, expectedSeq)) uplinkAcknowledged = true;
    String handledCommandId = handleGatewayCommand(payload);
    if (handledCommandId.length() > 0) {
      commandAckId = handledCommandId;
      commandAccepted = lastCommandAccepted;
      commandResultReason = lastCommandResultReason;
    }
    LoRa.receive();
  }

  if (commandAckId.length() > 0) {
    sendCommandAckPacket(commandAckId, commandAccepted, commandResultReason);
  }
  if (loraReady) LoRa.sleep();
  return uplinkAcknowledged;
}

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

// sendMeasurement: วัดหนึ่งรอบแล้วส่งค่าที่วัดได้พร้อมสถานะทันที
void sendMeasurement(const SensorData &current, FireStatus status) {
  String payload = buildJsonPacket(current, status);
  sendSensorPacketWithAck(payload);
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


// resetRuntimeStateForTestMode: ล้างสถานะ RTC เพื่อให้การทดสอบแต่ละครั้งเริ่มเหมือนกัน
void resetRuntimeStateForTestMode() {
#if TEST_MODE
  seq = 0;
  do {
    bootSessionId = esp_random();
  } while (bootSessionId == 0);
  rtcRiskStateVersion = RTC_RISK_STATE_VERSION;
  latchedStatusValue = NORMAL;
  releaseCounter = 0;
#endif
}

// setup: Arduino เรียกครั้งเดียวต่อการเริ่มเครื่อง รวมถึงหลังตื่นจาก การหลับลึก; เปิด การตรวจหาปัญหา เตรียมรหัส โหลดข้อมูล และเริ่มอุปกรณ์ก่อนเข้ารอบวัด
void setup() {
#if SERIAL_DEBUG
  Serial.begin(SERIAL_BAUD);
  delay(1000);
#endif

  resetRuntimeStateForTestMode();
  ensureRtcRiskState();

  disableUnusedRadios();
  randomSeed(esp_random());

  if (bootSessionId == 0) {
    do {
      bootSessionId = esp_random();
    } while (bootSessionId == 0);
  }
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

// loop: Arduino เรียกซ้ำเมื่อ setup จบ โดยแต่ละครั้งทำรอบวัดหนึ่งรอบ; ถ้าเข้า การหลับลึก จะตื่นกลับไปเริ่ม setup ใหม่
void loop() {
  runOneMeasurementCycle();
}
