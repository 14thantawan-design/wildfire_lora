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

  คำสำคัญ: ค่าฐาน = ค่าปกติที่เรียนรู้, ผลต่าง = ปัจจุบันลบค่าอ้างอิง, อัตราการเปลี่ยนแปลง = ผลต่างต่อนาที
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
// สถานะที่ระบบใช้: เซนเซอร์เสีย / กำลังเรียนฐาน / ปกติ / เฝ้าระวัง / เตือน / วิกฤต ตามลำดับด้านล่าง
enum FireStatus {
  SENSOR_FAULT,
  CALIBRATING,
  NORMAL,
  WATCH,
  WARNING,
  CRITICAL
};

// struct รวมค่าที่อ่านหนึ่งรอบ: airTemp (°C), humidity (%RH), smokeRaw (ADC ไม่ใช่ค่า PM2.5), shtOk/sharpOk คือธงผ่านการตรวจ
struct SensorData {
  float airTemp;
  float humidity;
  int smokeRaw;
  bool shtOk;
  bool sharpOk;
};

// รวมผลต่างสามแบบ: Delta เทียบครั้งก่อน, RatePerMin หารด้วยนาที, BaselineDelta เทียบค่าปกติ; ความชื้นติดลบหมายถึงแห้งลง
struct DeltaData {
  // ผลต่างจากค่าที่อ่านในรอบก่อนหน้าทันที
  float airTempDelta;
  float humidityDelta;
  int smokeDelta;

  // ผลต่างจากรอบก่อนที่แปลงเป็นอัตราต่อนาที ช่วยให้เปรียบเทียบได้เมื่อช่วงเวลาหลับเปลี่ยน
  float airTempRatePerMin;
  float humidityRatePerMin;  // ค่าติดลบหมายถึงความชื้นกำลังลดลง
  float smokeRatePerMin;

  // ผลต่างจากค่าปกติที่เรียนรู้ ช่วยให้ยังแจ้งเตือนเมื่อค่าคงอยู่สูงแม้ไม่เพิ่มจากรอบก่อนแล้ว
  float airTempBaselineDelta;
  float humidityBaselineDelta; // ค่าปัจจุบันลบค่าฐาน; ค่าติดลบหมายถึงความชื้นลดลง
  int smokeBaselineDelta;

  float elapsedMinutes;
};

// ธงหลักฐานแต่ละกลุ่ม: Watch ระดับอ่อน, Group ระดับเตือน, Critical ระดับแรง; groupCount นับ Group ไม่ได้นับจำนวนเซนเซอร์จริง
struct EvidenceFlags {
  bool smokeWatch;
  bool smokeGroup;
  bool smokeCritical;
  bool heatWatch;
  bool heatGroup;
  bool heatCritical;
  bool humidityWatch;
  bool humidityGroup;
  bool humidityCritical;
  int groupCount;
};

// พิกัดละติจูด/ลองจิจูดและธง valid; มีเลขพิกัดอย่างเดียวไม่ได้แปลว่าใช้ได้ ต้องดู valid ด้วย
struct GpsLocation {
  double latitude;
  double longitude;
  bool valid;
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
// nodeGpsLocation คือพิกัดที่นำไปใช้ ส่วน gpsWorkingLocation เป็นพื้นที่ทำงานระหว่างค้น; เริ่มด้วย valid=false
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
// จำคำสั่งล่าสุดและเปิดพื้นที่ NVS แยกสำหรับคำสั่ง/ฐาน; ป้องกันการทำคำสั่งซ้ำโดยไม่เกี่ยวกับหมายเลขข้อมูลวัด
String lastHandledCommandId;
Preferences commandPrefs;
Preferences baselinePrefs;
unsigned long lastLoRaInitAttemptMs = 0;
bool loraReady = false;
// สำเนาค่ารอบล่าสุดและสถานะสำหรับตรวจคำสั่งปรับฐาน; เริ่มว่าไม่พร้อม จึงไม่อนุญาตก่อนมีการวัด
SensorData commandSafetyData = {NAN, NAN, -1, false, false};
FireStatus commandSafetyStatus = SENSOR_FAULT;
bool commandSafetyReady = false;
// จำว่ามีคำสั่งล้างฐานระหว่างส่งรอบนี้ และผลตอบคำสั่งล่าสุด เพื่อเลือกสถานะ/เวลารอใหม่ให้ตรง
bool baselineRecalibrationAcceptedThisCycle = false;
bool lastCommandAccepted = true;
String lastCommandResultReason;

// seq คือเลขชุดข้อมูล; bootSessionId แยกชุดหลังเริ่มเครื่องใหม่; hasPreviousData กันใช้ previousData ก่อนเคยวัดจริง
RTC_DATA_ATTR uint32_t seq = 0;
RTC_DATA_ATTR uint32_t bootSessionId = 0;
RTC_DATA_ATTR bool hasPreviousData = false;
RTC_DATA_ATTR SensorData previousData;
RTC_DATA_ATTR unsigned long previousReadMs = 0;
// ใช้ในโหมดภาคสนาม เพราะ millis() เริ่มนับใหม่หลังหลับลึก แต่ข้อมูลในหน่วยความจำ RTC ยังอยู่
RTC_DATA_ATTR float expectedNextElapsedMinutes = 0.0f;

// จำสถานะที่ค้างและจำนวนรอบยืนยัน/ลดระดับข้าม การหลับลึก; หากลืมตัวนับทุกครั้งที่ตื่น อาจยืนยันต่อเนื่องไม่ครบ
RTC_DATA_ATTR int latchedStatusValue = NORMAL;
RTC_DATA_ATTR uint8_t releaseCounter = 0;
RTC_DATA_ATTR uint8_t criticalCandidateCounter = 0;
RTC_DATA_ATTR uint8_t weakWatchCandidateCounter = 0;

// การสะสมข้อมูลเริ่มต้นและค่าฐานปกติที่เรียนรู้แล้ว
// กลุ่มฐาน: ธงพร้อม จำนวนรอบสะสม/ผิดปกติ ผลรวมเพื่อเฉลี่ย ค่าฐานสามค่า และจำนวนรอบก่อนบันทึกแฟลชอีกครั้ง
RTC_DATA_ATTR bool baselineInitialized = false;
RTC_DATA_ATTR uint16_t baselineWarmupCount = 0;
RTC_DATA_ATTR uint16_t bootAbnormalCount = 0;
RTC_DATA_ATTR float warmupAirSum = 0.0f;
RTC_DATA_ATTR float warmupHumiditySum = 0.0f;
RTC_DATA_ATTR long warmupSmokeSum = 0;
RTC_DATA_ATTR float baselineAirTemp = 0.0f;
RTC_DATA_ATTR float baselineHumidity = 0.0f;
RTC_DATA_ATTR int baselineSmokeRaw = 0;
RTC_DATA_ATTR uint16_t baselineNvsCyclesSinceSave = 0;

// =========================
// ฟังก์ชันช่วยทำงานทั่วไป
// =========================
// statusToString: แปลงสถานะชนิด FireStatus เป็นข้อความสำหรับ JSON และหน้าจอ การตรวจหาปัญหา; ถ้าไม่มี ตัวเรียกจะไม่มีตัวแปลงชื่อสถานะ
const char* statusToString(FireStatus status) {
  switch (status) {
    case SENSOR_FAULT: return "SENSOR_FAULT";
    case CALIBRATING: return "CALIBRATING";
    case NORMAL: return "NORMAL";
    case WATCH: return "WATCH";
    case WARNING: return "WARNING";
    case CRITICAL: return "CRITICAL";
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

// readSharpOnce: อ่านอนุภาคจาก Sharp หนึ่งครั้ง โดยเปิด LED ภายในแล้วอ่าน ADC ตามจังหวะ; ถ้าตัดการควบคุม LED/เวลารอออก ค่าที่อ่านอาจไม่ตรงช่วงวัด
int readSharpOnce() {
  // จังหวะอ่าน GP2Y1014: เปิดแอลอีดี รอ 280 ไมโครวินาที อ่าน ADC รอ 40 ไมโครวินาที แล้วปิดแอลอีดี
  // วงจร Sharp ส่วนมากใช้ LOW เพื่อเปิดแอลอีดี และ HIGH เพื่อปิดแอลอีดี
  digitalWrite(SHARP_LED_PIN, LOW);
  delayMicroseconds(280);
  int raw = analogRead(SHARP_ANALOG_PIN);
  delayMicroseconds(40);
  digitalWrite(SHARP_LED_PIN, HIGH);
  delayMicroseconds(9680);
  return raw;
}

// readSmokeMedian: อ่าน Sharp สามครั้งแล้วคืนค่ามัธยฐาน; ถ้าอ่านครั้งเดียว ค่ากระโดดอาจหลุดไปเข้าตรรกะแจ้งเตือนง่ายขึ้น
int readSmokeMedian() {
  int a = readSharpOnce();
  delay(5);
  int b = readSharpOnce();
  delay(5);
  int c = readSharpOnce();
  return median3(a, b, c);
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
  // ADC 12 บิตอ่านได้ 0–4095 ซึ่งต้องตรงกับเกณฑ์ตรวจ Sharp ด้านล่าง
  analogReadResolution(12);

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
  data.smokeRaw = -1;
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

  int smoke = readSmokeMedian();
  data.smokeRaw = smoke;
  // ตรวจแค่ช่วงตัวเลข: แม้ 0 หรือ 4095 ค้างก็ยังผ่านโค้ดนี้ จึงอย่าตีความ OK ว่าอุปกรณ์สมบูรณ์แน่นอน
  data.sharpOk = (smoke >= 0 && smoke <= 4095);

  return data;
}

// hasSensorFault: คืน true เมื่อธงสุขภาพตัวใดตัวหนึ่งเป็น false; Sharp รุ่นนี้ตรวจเพียงช่วง ADC 0–4095 ยังตรวจสายหลุดหรือค่าค้างได้ไม่ครบ
bool hasSensorFault(const SensorData &data) {
  if (!data.shtOk) return true;
  if (!data.sharpOk) return true;
  return false;
}

// isBootAbnormalReading: กันข้อมูลที่เสีย ควันสูง ร้อนจัด หรือแห้งมาก ไม่ให้ใช้เรียนรู้ค่าปกติช่วงเริ่มเครื่อง; หากข้าม อาจจำสภาพผิดปกติเป็น ค่าฐาน
bool isBootAbnormalReading(const SensorData &data) {
  if (hasSensorFault(data)) return true;
  if (data.smokeRaw >= SMOKE_RAW_WARNING) return true;
  if (!isnan(data.airTemp) && data.airTemp >= AIR_TEMP_ABSOLUTE_WARNING) return true;
  if (!isnan(data.humidity) && data.humidity <= HUMIDITY_VERY_LOW) return true;
  return false;
}

// isStoredBaselineSane: ตรวจค่าฐานที่อ่านจากหน่วยความจำว่ามีตัวเลขและอยู่ในช่วงยอมรับได้; ไม่ได้รับรองว่ายังเหมาะกับสถานที่ติดตั้งใหม่
bool isStoredBaselineSane(float airTemp, float humidity, int smokeRaw) {
  return !isnan(airTemp) && !isnan(humidity) &&
         airTemp >= SHT31_MIN_TEMP_C && airTemp <= SHT31_MAX_TEMP_C &&
         humidity >= SHT31_MIN_HUMIDITY && humidity <= SHT31_MAX_HUMIDITY &&
         smokeRaw >= 0 && smokeRaw <= 4095;
}

// loadBaselineFromNvs: คืน true เมื่อนำ ค่าฐาน ที่เคยบันทึกกลับมาใช้ได้; TEST_MODE ไม่โหลด ส่วน FORCE_RECALIBRATE ล้างข้อมูลเดิม หากไม่มีต้องสะสมค่าฐานใหม่หลังไฟดับ
bool loadBaselineFromNvs() {
#if BASELINE_SAVE_TO_NVS && !TEST_MODE
  if (baselineInitialized) return true;

#if BASELINE_FORCE_RECALIBRATE
  if (baselinePrefs.begin("node_base", false)) {
    baselinePrefs.clear();
    baselinePrefs.end();
  }
  return false;
#else
  if (!baselinePrefs.begin("node_base", true)) return false;
  bool valid = baselinePrefs.getBool("valid", false);
  uint32_t version = baselinePrefs.getUInt("ver", 0);
  float airTemp = baselinePrefs.getFloat("air", NAN);
  float humidity = baselinePrefs.getFloat("hum", NAN);
  int smokeRaw = baselinePrefs.getInt("smoke", -1);
  baselinePrefs.end();

  if (!valid || version != BASELINE_STORAGE_VERSION ||
      !isStoredBaselineSane(airTemp, humidity, smokeRaw)) return false;

  baselineAirTemp = airTemp;
  baselineHumidity = humidity;
  baselineSmokeRaw = smokeRaw;
  baselineInitialized = true;
  baselineWarmupCount = BASELINE_WARMUP_CYCLES;
  bootAbnormalCount = 0;
  baselineNvsCyclesSinceSave = 0;
  debugPrintln("Baseline restored from NVS");
  return true;
#endif
#else
  return false;
#endif
}

// saveBaselineToNvs: เก็บ ค่าฐาน ลงแฟลช NVS เพื่อใช้หลังตัดไฟ; ตั้ง valid=false ก่อนเขียนแล้ว true ท้ายสุดเพื่อลดโอกาสอ่านชุดที่เขียนไม่ครบ ทั้งนี้โค้ดไม่ได้ตรวจผล put แต่ละตัว
void saveBaselineToNvs() {
#if BASELINE_SAVE_TO_NVS && !TEST_MODE
  if (!baselineInitialized ||
      !isStoredBaselineSane(baselineAirTemp, baselineHumidity, baselineSmokeRaw)) return;
  if (!baselinePrefs.begin("node_base", false)) return;
  baselinePrefs.putBool("valid", false);
  baselinePrefs.putUInt("ver", BASELINE_STORAGE_VERSION);
  baselinePrefs.putFloat("air", baselineAirTemp);
  baselinePrefs.putFloat("hum", baselineHumidity);
  baselinePrefs.putInt("smoke", baselineSmokeRaw);
  baselinePrefs.putBool("valid", true);
  baselinePrefs.end();
  baselineNvsCyclesSinceSave = 0;
  debugPrintln("Baseline saved to NVS");
#endif
}

// clearLearnedBaseline: ล้าง ค่าฐาน ใน NVS (ถ้าเปิดใช้) และตัวแปรสะสม พร้อมกลับ CALIBRATING; คืน false เมื่อเปิด NVS ไม่ได้ การเรียกนี้ทำให้ต้องเรียนรู้ใหม่
bool clearLearnedBaseline() {
#if BASELINE_SAVE_TO_NVS && !TEST_MODE
  if (!baselinePrefs.begin("node_base", false)) return false;
  baselinePrefs.clear();
  baselinePrefs.end();
#endif

  baselineInitialized = false;
  baselineWarmupCount = 0;
  bootAbnormalCount = 0;
  warmupAirSum = 0.0f;
  warmupHumiditySum = 0.0f;
  warmupSmokeSum = 0;
  baselineAirTemp = 0.0f;
  baselineHumidity = 0.0f;
  baselineSmokeRaw = 0;
  baselineNvsCyclesSinceSave = 0;
  latchedStatusValue = CALIBRATING;
  releaseCounter = 0;
  criticalCandidateCounter = 0;
  weakWatchCandidateCounter = 0;
  baselineRecalibrationAcceptedThisCycle = true;
  debugPrintln("Baseline cleared; recalibration requested");
  return true;
}

// baselineRecalibrationBlockReason: คืนข้อความเหตุผลที่ไม่ยอมเรียน ค่าฐาน ใหม่ หรือข้อความว่างเมื่ออนุญาต; ป้องกันล้างฐานขณะข้อมูลเสีย/วิกฤต/ค่าจริงไม่ปลอดภัย แต่ WATCH หรือ WARNING ที่ค่าจริงผ่านเกณฑ์ยังทำได้
String baselineRecalibrationBlockReason() {
  if (!commandSafetyReady) return "measurement_unavailable";
  if (hasSensorFault(commandSafetyData)) return "sensor_fault";
  if (commandSafetyStatus == CALIBRATING) return "already_calibrating";
  // การย้ายจากห้องเย็นไปพื้นที่อุ่นกว่าอาจทำให้ค่าฐานเดิมนำไปสู่สถานะเตือน
  // แม้ค่าที่วัดจริงในขณะนั้นยังผ่านเกณฑ์ที่อนุญาตให้เรียนรู้ฐานใหม่
  if (commandSafetyStatus == CRITICAL || commandSafetyStatus == SENSOR_FAULT) {
    return "unsafe_state";
  }
  if (isBootAbnormalReading(commandSafetyData)) return "unsafe_reading";
  return "";
}

// updateBaselineWarmup: สะสมเฉพาะรอบที่ผ่านเกณฑ์แล้วหาค่าเฉลี่ยเมื่อครบจำนวน; คืนว่าฐานพร้อมหรือยัง รอบผิดปกติถูกข้ามและไม่ได้ล้างผลรวมรอบดีก่อนหน้า
bool updateBaselineWarmup(const SensorData &data) {
  if (baselineInitialized) return true;
  if (hasSensorFault(data)) return false;

  if (isBootAbnormalReading(data)) {
    if (bootAbnormalCount < 255) bootAbnormalCount++;
    return false;
  }

  warmupAirSum += data.airTemp;
  warmupHumiditySum += data.humidity;
  warmupSmokeSum += data.smokeRaw;
  baselineWarmupCount++;

  if (baselineWarmupCount >= BASELINE_WARMUP_CYCLES) {
    baselineAirTemp = warmupAirSum / baselineWarmupCount;
    baselineHumidity = warmupHumiditySum / baselineWarmupCount;
    baselineSmokeRaw = (int)(warmupSmokeSum / baselineWarmupCount);
    baselineInitialized = true;
    saveBaselineToNvs();
  }

  return baselineInitialized;
}

// getElapsedMinutesForDelta: คืนเวลาระหว่างการวัดเป็นนาที: ทดสอบใช้ millis เมื่อใช้ได้ ส่วนภาคสนามอาศัยช่วงที่คาดไว้; เป็นค่าประมาณ ไม่รวมเวลาทำงานทั้งหมดหลังตื่น
float getElapsedMinutesForDelta(unsigned long nowMs) {
#if TEST_MODE
  if (previousReadMs > 0 && nowMs >= previousReadMs) {
    float measured = (nowMs - previousReadMs) / 60000.0f;
    if (measured >= 0.001f) return measured;
  }
  if (expectedNextElapsedMinutes > 0.0f) return expectedNextElapsedMinutes;
  return LOOP_INTERVAL_MS / 60000.0f;
#else
  if (expectedNextElapsedMinutes > 0.0f) return expectedNextElapsedMinutes;
  return NORMAL_SLEEP_SEC / 60.0f;
#endif
}

// calculateDelta: คืนผลต่างจากครั้งก่อน อัตราต่อนาที และผลต่างจาก ค่าฐาน; ถ้าไม่มีข้อมูลก่อนหน้าจะไม่คำนวณ อัตราการเปลี่ยนแปลง ส่วน ค่าฐาน ช่วยจับค่าที่สูงค้างแม้ไม่เพิ่มแล้ว
DeltaData calculateDelta(const SensorData &current, const SensorData &previous, bool hasPrev, unsigned long nowMs) {
  DeltaData d;
  d.airTempDelta = 0.0f;
  d.humidityDelta = 0.0f;
  d.smokeDelta = 0;
  d.airTempRatePerMin = 0.0f;
  d.humidityRatePerMin = 0.0f;
  d.smokeRatePerMin = 0.0f;
  d.airTempBaselineDelta = 0.0f;
  d.humidityBaselineDelta = 0.0f;
  d.smokeBaselineDelta = 0;
  d.elapsedMinutes = 0.0f;

  if (hasPrev) {
    d.elapsedMinutes = getElapsedMinutesForDelta(nowMs);
    // กันหารด้วยศูนย์หรือช่วงเวลาสั้นเกินไปจน อัตราการเปลี่ยนแปลง พุ่งผิดธรรมชาติ
    if (d.elapsedMinutes < 0.001f) d.elapsedMinutes = 0.001f;

    if (!isnan(current.airTemp) && !isnan(previous.airTemp)) d.airTempDelta = current.airTemp - previous.airTemp;
    if (!isnan(current.humidity) && !isnan(previous.humidity)) d.humidityDelta = current.humidity - previous.humidity;
    if (current.smokeRaw >= 0 && previous.smokeRaw >= 0) d.smokeDelta = current.smokeRaw - previous.smokeRaw;

    d.airTempRatePerMin = d.airTempDelta / d.elapsedMinutes;
    d.humidityRatePerMin = d.humidityDelta / d.elapsedMinutes;
    d.smokeRatePerMin = d.smokeDelta / d.elapsedMinutes;
  }

  if (baselineInitialized) {
    if (!isnan(current.airTemp)) d.airTempBaselineDelta = current.airTemp - baselineAirTemp;
    if (!isnan(current.humidity)) d.humidityBaselineDelta = current.humidity - baselineHumidity;
    if (current.smokeRaw >= 0) d.smokeBaselineDelta = current.smokeRaw - baselineSmokeRaw;
  }

  return d;
}

// getEvidenceFlags: แปลงค่าเซนเซอร์เป็นหลักฐานสามกลุ่ม: ควัน ความร้อน ความชื้น; ใช้ทั้งอัตราเพิ่ม/ลด ความต่างจากฐาน และเกณฑ์ค่าจริง แล้วนับจำนวนกลุ่มที่เข้าเกณฑ์
EvidenceFlags getEvidenceFlags(const SensorData &data, const DeltaData &delta) {
  EvidenceFlags e;
  // กลับเครื่องหมายให้การลดความชื้นกลายเป็นจำนวนบวก เพื่อเทียบเกณฑ์การลดได้ตรงกัน
  float humidityDropFromBaseline = -delta.humidityBaselineDelta;

  // ต้องเปลี่ยนมากพอทั้งขนาดจริงและอัตราต่อนาที ช่วยไม่ขยายการสั่นเล็ก ๆ เป็นสัญญาณเตือนเมื่อวัดถี่
  bool smokeRateWatch = delta.smokeDelta >= SMOKE_RATE_MIN_DELTA_RAW &&
                        delta.smokeRatePerMin >= SMOKE_RATE_WATCH_PER_MIN;
  bool smokeRateWarning = delta.smokeDelta >= SMOKE_RATE_MIN_DELTA_RAW &&
                          delta.smokeRatePerMin >= SMOKE_RATE_WARNING_PER_MIN;
  bool smokeRateCritical = delta.smokeDelta >= SMOKE_RATE_MIN_DELTA_RAW &&
                           delta.smokeRatePerMin >= SMOKE_RATE_CRITICAL_PER_MIN;

  bool airTempRateWatch = delta.airTempDelta >= AIR_TEMP_RATE_MIN_DELTA_C &&
                          delta.airTempRatePerMin >= AIR_TEMP_RATE_WATCH_PER_MIN;
  bool airTempRateWarning = delta.airTempDelta >= AIR_TEMP_RATE_MIN_DELTA_C &&
                            delta.airTempRatePerMin >= AIR_TEMP_RATE_WARNING_PER_MIN;
  bool airTempRateCritical = delta.airTempDelta >= AIR_TEMP_RATE_MIN_DELTA_C &&
                             delta.airTempRatePerMin >= AIR_TEMP_RATE_CRITICAL_PER_MIN;

  bool humidityRateWatch = (-delta.humidityDelta) >= HUMIDITY_DROP_RATE_MIN_DELTA &&
                           (-delta.humidityRatePerMin) >= HUMIDITY_DROP_RATE_WATCH_PER_MIN;
  bool humidityRateWarning = (-delta.humidityDelta) >= HUMIDITY_DROP_RATE_MIN_DELTA &&
                             (-delta.humidityRatePerMin) >= HUMIDITY_DROP_RATE_WARNING_PER_MIN;
  bool humidityRateCritical = (-delta.humidityDelta) >= HUMIDITY_DROP_RATE_MIN_DELTA &&
                              (-delta.humidityRatePerMin) >= HUMIDITY_DROP_RATE_CRITICAL_PER_MIN;

  bool smokeBaselineWatch = delta.smokeBaselineDelta >= SMOKE_BASELINE_WATCH &&
                            data.smokeRaw >= SMOKE_RAW_WATCH_MIN;

  e.smokeWatch = smokeRateWatch || smokeBaselineWatch;
  e.smokeGroup = smokeRateWarning ||
                 delta.smokeBaselineDelta >= SMOKE_BASELINE_WARNING ||
                 data.smokeRaw >= SMOKE_RAW_WARNING;
  e.smokeCritical = smokeRateCritical ||
                    delta.smokeBaselineDelta >= SMOKE_BASELINE_CRITICAL ||
                    data.smokeRaw >= SMOKE_RAW_CRITICAL;

  e.heatWatch = airTempRateWatch ||
                delta.airTempBaselineDelta >= AIR_TEMP_BASELINE_WATCH;
  e.heatGroup = airTempRateWarning ||
                delta.airTempBaselineDelta >= AIR_TEMP_BASELINE_WARNING ||
                (!isnan(data.airTemp) && data.airTemp >= AIR_TEMP_ABSOLUTE_WARNING);
  e.heatCritical = airTempRateCritical ||
                   delta.airTempBaselineDelta >= AIR_TEMP_BASELINE_CRITICAL ||
                   (!isnan(data.airTemp) && data.airTemp >= AIR_TEMP_ABSOLUTE_CRITICAL);

  e.humidityWatch = humidityRateWatch ||
                    humidityDropFromBaseline >= HUMIDITY_BASELINE_DROP_WATCH;
  e.humidityGroup = humidityRateWarning ||
                    humidityDropFromBaseline >= HUMIDITY_BASELINE_DROP_WARNING ||
                    (!isnan(data.humidity) && data.humidity <= HUMIDITY_LOW);
  e.humidityCritical = humidityRateCritical ||
                       humidityDropFromBaseline >= HUMIDITY_BASELINE_DROP_CRITICAL ||
                       (!isnan(data.humidity) && data.humidity <= HUMIDITY_VERY_LOW);

  e.groupCount = 0;
  if (e.smokeGroup) e.groupCount++;
  if (e.heatGroup) e.groupCount++;
  if (e.humidityGroup) e.groupCount++;
  return e;
}

// calculateConfidence: รวมคะแนนหลักฐานแล้วจำกัด 0–100; เป็นคะแนนตามกฎของโครงการ ไม่ใช่ความน่าจะเป็นเกิดไฟที่สอบเทียบแล้ว พารามิเตอร์ ผลต่าง ยังไม่ได้ใช้ในฟังก์ชันนี้
int calculateConfidence(const SensorData &data, const DeltaData &delta, const EvidenceFlags &e) {
  int score = 0;

  // แต่ละกลุ่มเลือกคะแนนขั้นสูงสุดเพียงขั้นเดียวด้วย if/else if จึงไม่บวก Watch+Group+Critical ซ้อนกัน
  if (e.smokeCritical) score += 20;
  else if (e.smokeGroup) score += 10;
  else if (e.smokeWatch) score += 5;

  if (e.heatCritical) score += 40;
  else if (e.heatGroup) score += 25;
  else if (e.heatWatch) score += 10;

  if (e.humidityCritical) score += 40;
  else if (e.humidityGroup) score += 25;
  else if (e.humidityWatch) score += 10;

  if (hasSensorFault(data)) score -= 40;
  // ฐานยังไม่พร้อมจำกัดคะแนนไม่เกิน 60 เสมอ; สถานะช่วงนี้ใช้กฎเริ่มเครื่องใน evaluateFireStatusRaw
  if (!baselineInitialized) score = min(score, 60); // ก่อนค่าฐานพร้อม จำกัดคะแนนไม่เกิน 60; สถานะใช้กฎช่วงเริ่มเครื่องแยกต่างหาก

  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

// evaluateFireStatusRaw: ตัดสินจากสุขภาพเซนเซอร์ ความพร้อมค่าฐาน และคะแนน; ยังไม่ผ่านการยืนยันหรือค้างสถานะ
FireStatus evaluateFireStatusRaw(const SensorData &data, const EvidenceFlags &e, int confidence) {
  if (hasSensorFault(data)) return SENSOR_FAULT;

  if (!baselineInitialized) {
    if (bootAbnormalCount >= BOOT_ABNORMAL_REQUIRED_CYCLES) {
      if (e.smokeCritical && (e.heatGroup || e.humidityGroup)) return WARNING;
      return WATCH;
    }
    return CALIBRATING;
  }

  // ดัชนีความเสี่ยง ไม่ใช่เปอร์เซ็นต์โอกาสเกิดไฟ; ควันไม่ใช่เงื่อนไขบังคับ
  // ใช้คะแนนตัดระดับ แล้วให้ debounce/latch ยืนยันการเปลี่ยนสถานะ
  if (confidence >= CRITICAL_CONFIDENCE) return CRITICAL;
  if (confidence >= WARNING_CONFIDENCE) return WARNING;
  if (confidence >= WATCH_CONFIDENCE) return WATCH;
  return NORMAL;
}

// statusSeverity: แปลงชื่อสถานะเป็นอันดับสำหรับเปรียบเทียบในโค้ด; SENSOR_FAULT อันดับ 0 ไม่ได้หมายความว่าเซนเซอร์เสียปลอดภัย
int statusSeverity(FireStatus status) {
  switch (status) {
    case SENSOR_FAULT: return 0;
    case CALIBRATING: return 1;
    case NORMAL: return 2;
    case WATCH: return 3;
    case WARNING: return 4;
    case CRITICAL: return 5;
    default: return 0;
  }
}

// isWeakEnvironmentalWatch: ระบุ WATCH อ่อนจากสิ่งแวดล้อมที่ไม่มีควันและไม่มีหลักฐานกลุ่มแรง; คืน true เพื่อให้ขั้นต่อไปรอยืนยันหลายรอบ
bool isWeakEnvironmentalWatch(FireStatus rawStatus, const EvidenceFlags &e, int confidence) {
  if (rawStatus != WATCH) return false;
  if (e.smokeWatch || e.smokeGroup || e.smokeCritical) return false;
  if (e.heatGroup || e.humidityGroup) return false;
  if (confidence >= WARNING_CONFIDENCE) return false;
  return e.heatWatch || e.humidityWatch;
}

// applyWeakWatchDebounce: หน่วง WATCH อ่อนจนพบต่อเนื่องครบจำนวนเมื่อสถานะเดิมต่ำกว่า WATCH; ถ้าตัดออก อากาศแกว่งเล็กน้อยอาจทำให้เปลี่ยนสถานะเร็วขึ้น
FireStatus applyWeakWatchDebounce(FireStatus rawStatus, const EvidenceFlags &e, int confidence) {
#if WATCH_ENV_CONFIRM_CYCLES <= 1
  weakWatchCandidateCounter = 0;
  return rawStatus;
#else
  if (!isWeakEnvironmentalWatch(rawStatus, e, confidence)) {
    weakWatchCandidateCounter = 0;
    return rawStatus;
  }

  FireStatus latched = (FireStatus)latchedStatusValue;
  if (statusSeverity(latched) >= statusSeverity(WATCH)) {
    weakWatchCandidateCounter = 0;
    return rawStatus;
  }

  if (weakWatchCandidateCounter < 255) weakWatchCandidateCounter++;
  if (weakWatchCandidateCounter >= WATCH_ENV_CONFIRM_CYCLES) return rawStatus;
  return NORMAL;
#endif
}

// applyCriticalDebounce: ให้ CRITICAL ใหม่ต้องเข้าเงื่อนไขต่อเนื่องครบจำนวน ระหว่างรอคืน WARNING; ถ้าเดิม CRITICAL แล้วคงไว้ และรีเซ็ตตัวนับเมื่อไม่เข้าเงื่อนไข
FireStatus applyCriticalDebounce(FireStatus rawStatus) {
  if (rawStatus == CRITICAL) {
    if ((FireStatus)latchedStatusValue == CRITICAL) return CRITICAL;
    if (criticalCandidateCounter < 255) criticalCandidateCounter++;
    if (criticalCandidateCounter >= CRITICAL_CONFIRM_CYCLES) return CRITICAL;
    return WARNING; // รอบแรกที่เข้าเงื่อนไขวิกฤตให้เป็นสถานะเตือนก่อน แล้วรอยืนยันรอบถัดไป
  }

  criticalCandidateCounter = 0;
  return rawStatus;
}

// applyStateLatch: ค้างสถานะเดิมก่อนลดระดับจนคะแนนและจำนวนรอบผ่านเกณฑ์; ลดการสลับสถานะไปมา แต่ SENSOR_FAULT/CALIBRATING จะคืนทันทีโดยไม่รอ
FireStatus applyStateLatch(FireStatus rawStatus, int confidence) {
  FireStatus latched = (FireStatus)latchedStatusValue;

  if (rawStatus == SENSOR_FAULT || rawStatus == CALIBRATING) {
    latchedStatusValue = rawStatus;
    releaseCounter = 0;
    return rawStatus;
  }

  if (statusSeverity(rawStatus) >= statusSeverity(latched)) {
    latchedStatusValue = rawStatus;
    releaseCounter = 0;
    return rawStatus;
  }

  bool allowRelease = false;
  if (latched == CRITICAL) allowRelease = confidence < CRITICAL_RELEASE_CONFIDENCE;
  else if (latched == WARNING) allowRelease = confidence < WARNING_RELEASE_CONFIDENCE;
  else allowRelease = true;

  if (allowRelease) {
    releaseCounter++;
    if (releaseCounter >= STATUS_RELEASE_CYCLES) {
      latchedStatusValue = rawStatus;
      releaseCounter = 0;
      return rawStatus;
    }
  } else {
    releaseCounter = 0;
  }

  return latched;
}

// evaluateFireStatus: รวมลำดับตัดสินจริง: สถานะดิบ → ยืนยัน CRITICAL → ยืนยัน WATCH อ่อน → ค้างสถานะ; การสลับลำดับอาจเปลี่ยนผลลัพธ์
FireStatus evaluateFireStatus(const SensorData &data, const EvidenceFlags &e, int confidence) {
  FireStatus rawStatus = evaluateFireStatusRaw(data, e, confidence);
  rawStatus = applyCriticalDebounce(rawStatus);
  rawStatus = applyWeakWatchDebounce(rawStatus, e, confidence);
  return applyStateLatch(rawStatus, confidence);
}

// updateBaselineAfterDecision: ปรับฐานช้า ๆ หลังตัดสินแล้ว: NORMAL ปรับทั้งสามค่า; WATCH ที่ไม่มี smokeWatch/smokeGroup ปรับเฉพาะอุณหภูมิ/ความชื้น; ถ้าปรับก่อนตัดสินอาจกลบความผิดปกติ
void updateBaselineAfterDecision(const SensorData &data, const DeltaData &delta, const EvidenceFlags &e, FireStatus status) {
  if (!baselineInitialized || hasSensorFault(data)) return;

  if (status == NORMAL) {
    // EMA ขยับฐานเข้าหาค่าใหม่ทีละส่วน เช่น alpha=0.05 คือขยับ 5% ของผลต่าง ไม่แทนฐานด้วยค่าปัจจุบันทั้งหมด
    baselineAirTemp = baselineAirTemp + BASELINE_EMA_ALPHA * (data.airTemp - baselineAirTemp);
    baselineHumidity = baselineHumidity + BASELINE_EMA_ALPHA * (data.humidity - baselineHumidity);
    baselineSmokeRaw = (int)(baselineSmokeRaw + BASELINE_EMA_ALPHA * (data.smokeRaw - baselineSmokeRaw));
    if (baselineNvsCyclesSinceSave < BASELINE_NVS_SAVE_INTERVAL_CYCLES) {
      baselineNvsCyclesSinceSave++;
    }
    if (baselineNvsCyclesSinceSave >= BASELINE_NVS_SAVE_INTERVAL_CYCLES) {
      saveBaselineToNvs();
    }
  } else if (status == WATCH && !e.smokeWatch && !e.smokeGroup) {
    // อุณหภูมิและความชื้นที่เปลี่ยนตามกลางวันกลางคืนอาจทำให้เฝ้าระวังแม้ไม่มีควัน
    // ปรับค่าฐานช้า ๆ เพื่อช่วยไม่ให้โหนดค้างสถานะเฝ้าระวังตลอดบ่ายจากการเปลี่ยนตามธรรมชาติ
    baselineAirTemp = baselineAirTemp + BASELINE_WATCH_NO_SMOKE_ALPHA * (data.airTemp - baselineAirTemp);
    baselineHumidity = baselineHumidity + BASELINE_WATCH_NO_SMOKE_ALPHA * (data.humidity - baselineHumidity);
  }
}

// addFloatOrNull: ใส่ค่าทศนิยมลง JSON ตาม key; ถ้า NaN ใช้ null เพื่อบอกว่าไม่มีข้อมูล แทนเลขศูนย์ที่อาจถูกเข้าใจว่าเป็นค่าจริง
void addFloatOrNull(JsonDocument &doc, const char *key, float value) {
  if (isnan(value)) doc[key] = nullptr;
  else doc[key] = value;
}

// sensorHealthString: คืน FAULT เมื่อเซนเซอร์เสีย, CAL เมื่อฐานยังไม่พร้อม, OK เมื่อผ่านทั้งสองส่วน; ใช้เป็นช่อง sh ในแพ็กเก็ต
String sensorHealthString(const SensorData &data) {
  if (hasSensorFault(data)) return "FAULT";
  if (!baselineInitialized) return "CAL";
  return "OK";
}

// plannedReportIntervalSeconds: คืนช่วงรายงานที่ตั้งใจเป็นวินาทีให้ เกตเวย์/ระบบปลายทางรู้รอบส่ง; เวลาจริงอาจยาวกว่าเพราะอ่านเซนเซอร์ ส่งซ้ำ และรอ ACK
uint32_t plannedReportIntervalSeconds(FireStatus status) {
#if TEST_MODE
  return status == CRITICAL ? max(1UL, CRITICAL_CONTINUE_INTERVAL_MS / 1000UL)
                            : max(1UL, LOOP_INTERVAL_MS / 1000UL);
#else
  if (status == CRITICAL) return max(1UL, CRITICAL_CONTINUE_INTERVAL_MS / 1000UL);
  if (status == CALIBRATING) return CALIBRATING_SLEEP_SEC;
  if (status == WATCH) return WATCH_SLEEP_SEC;
  if (status == WARNING) return WARNING_SLEEP_SEC;
  if (status == SENSOR_FAULT) return SENSOR_FAULT_SLEEP_SEC;
  return NORMAL_SLEEP_SEC;
#endif
}

// buildJsonPacket: ประกอบข้อมูลวัดเป็น JSON ย่อและเพิ่ม seq หนึ่งครั้งต่อข้อมูลชุดใหม่; คีย์สั้นช่วยประหยัดพื้นที่ LoRa การส่งซ้ำใช้ ข้อความที่จะส่ง เดิมเพื่อระบุว่าเป็นชุดเดียวกัน
String buildJsonPacket(const SensorData &data, const DeltaData &delta, FireStatus status, int confidence) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  seq++;

  // คีย์ JSON: t ชนิด, id โหนด, q ลำดับ, sid รอบบูต, ri ช่วงรายงานวินาที, st สถานะ, c คะแนน, at °C, h %RH, sm ADC
  doc["t"] = (status == CRITICAL) ? "c" : "s";
  doc["id"] = NODE_ID;
  doc["q"] = seq;
  doc["sid"] = bootSessionId;
  doc["ri"] = plannedReportIntervalSeconds(status);
  doc["st"] = statusToString(status);
  doc["c"] = confidence;
  doc["rv"] = RISK_MODEL_VERSION;
  addFloatOrNull(doc, "at", data.airTemp);
  addFloatOrNull(doc, "h", data.humidity);
  doc["sm"] = data.smokeRaw;

  // ส่งผลต่างไว้ตรวจสอบย้อนหลัง; เซิร์ฟเวอร์ใช้ st/c จากโหนดโดยไม่คำนวณซ้ำ
  // sr/ar/hr = ผลต่างควัน/อุณหภูมิ/ความชื้นจากฐาน; sh = สุขภาพ; bc/bt = จำนวนรอบสะสม/เป้าหมายเมื่อยังเรียนฐาน
  doc["sr"] = delta.smokeBaselineDelta;
  doc["ar"] = delta.airTempBaselineDelta;
  doc["hr"] = delta.humidityBaselineDelta;

  doc["sh"] = sensorHealthString(data);

  if (!baselineInitialized) {
    doc["bc"] = baselineWarmupCount;
    doc["bt"] = BASELINE_WARMUP_CYCLES;
  }
  String payload;
  serializeJson(doc, payload);

  // เมื่อข้อความยาวเกินเพดาน ตัดผลต่างประกอบออก แต่คงผลประเมินจากโหนดครบ
  if (payload.length() > MAX_SAFE_PAYLOAD_BYTES) {
    StaticJsonDocument<MAX_JSON_SIZE> mini;
    mini["t"] = (status == CRITICAL) ? "c" : "s";
    mini["id"] = NODE_ID;
    mini["q"] = seq;
    mini["sid"] = bootSessionId;
    mini["ri"] = plannedReportIntervalSeconds(status);
    mini["st"] = statusToString(status);
    mini["c"] = confidence;
    mini["rv"] = RISK_MODEL_VERSION;
    mini["at"] = data.airTemp;
    mini["h"] = data.humidity;
    mini["sm"] = data.smokeRaw;
    // ย่อโดยตัดเฉพาะผลต่างประกอบ; เก็บสถานะ คะแนน รุ่นสูตร และสุขภาพเสมอ
    mini["sh"] = sensorHealthString(data);
    if (!baselineInitialized) {
      mini["bc"] = baselineWarmupCount;
      mini["bt"] = BASELINE_WARMUP_CYCLES;
    }
    payload = ""; // serializeJson เติมท้าย String จึงต้องล้างฉบับเต็มก่อน
    serializeJson(mini, payload);
  }

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
// isGpsCoordinateValid: ตรวจช่วงละติจูด/ลองจิจูดและปฏิเสธจุดใกล้ (0,0) ตามกฎโครงการ; เป็นการกรองค่าตั้งต้น ไม่ใช่การพิสูจน์ความแม่นยำ GPS
bool isGpsCoordinateValid(double latitude, double longitude) {
  if (isnan(latitude) || isnan(longitude)) return false;
  if (latitude < -90.0 || latitude > 90.0) return false;
  if (longitude < -180.0 || longitude > 180.0) return false;
  if (fabs(latitude) < 0.000001 && fabs(longitude) < 0.000001) return false;
  return true;
}

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

  bool storedValid = gpsPrefs.getBool("valid", false);
  double latitude = gpsPrefs.getDouble("lat", 0.0);
  double longitude = gpsPrefs.getDouble("lng", 0.0);
  gpsPrefs.end();

  if (!storedValid || !isGpsCoordinateValid(latitude, longitude)) return false;

  fix.latitude = latitude;
  fix.longitude = longitude;
  fix.valid = true;
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

// saveGpsLocationToNvs: บันทึกพิกัดที่ valid และปิดธง กำหนดพิกัดเอง ลงแฟลช; ถ้าไม่บันทึกจะต้องหาตำแหน่งใหม่เมื่อข้อมูลใน RAM หาย
void saveGpsLocationToNvs(const GpsLocation &fix) {
#if GPS_SAVE_TO_NVS
  if (!fix.valid) return;
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

  if (gpsFix && fix.valid) {
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

// resetGpsLocation: ตั้งพิกัดกลับศูนย์และ valid=false; ธงนี้แยกค่าตั้งต้นออกจากตำแหน่งที่นำไปใช้ได้
void resetGpsLocation(GpsLocation &fix) {
  fix.latitude = 0.0;
  fix.longitude = 0.0;
  fix.valid = false;
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

// serviceOneShotGps: ทำงาน GPS เป็นช่วง ๆ: ส่งรายงานรอ ลองค้นใหม่เมื่อถึงเวลา อ่าน UART และตรวจคุณภาพ พิกัดที่ค้นได้; เมื่อสำเร็จบันทึก/หยุด GPS เมื่อหมดเวลานัดลองใหม่
void serviceOneShotGps() {
  sendPendingGpsReports();

  if (gpsOneShotState == GPS_ONE_SHOT_FAILED && !nodeGpsLocation.valid) {
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

  // ยอมรับ พิกัดที่ค้นได้ เมื่อพิกัด/ดาวเทียม/HDOP ผ่านและข้อมูลยังใหม่; HDOP ต่ำแสดงรูปทรงดาวเทียมที่เหมาะกว่า ไม่ใช่ค่าคลาดเคลื่อนเป็นเมตร
  if (gps.location.isValid() &&
      gps.satellites.isValid() &&
      gps.satellites.value() >= GPS_MIN_SATELLITES &&
      gps.hdop.isValid() &&
      gps.hdop.hdop() > 0.0 &&
      gps.hdop.hdop() <= GPS_MAX_HDOP &&
      gps.location.age() <= GPS_MAX_LOCATION_AGE_MS &&
      isGpsCoordinateValid(gps.location.lat(), gps.location.lng())) {
    gpsWorkingLocation.latitude = gps.location.lat();
    gpsWorkingLocation.longitude = gps.location.lng();
    gpsWorkingLocation.valid = true;
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
    Serial.print(" chars=");
    Serial.print(gps.charsProcessed());
    Serial.print(" ok=");
    Serial.print(gps.passedChecksum());
    Serial.print(" fail=");
    Serial.print(gps.failedChecksum());
    Serial.print(" sat=");
    Serial.print(gps.satellites.isValid() ? gps.satellites.value() : 0);
    Serial.print(" hdop=");
    Serial.print(gps.hdop.isValid() ? gps.hdop.hdop() : 0.0);
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

// saveLastHandledCommandId: บันทึกรหัสคำสั่งที่ทำแล้วทั้ง NVS และ RAM; ป้องกัน เกตเวย์ ส่งคำสั่งซ้ำแล้วเริ่มปรับฐาน/ค้น GPS ใหม่ซ้ำ
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
      (command != "gps_reacquire" && command != "gps_manual" &&
       command != "baseline_recalibrate")) return "";

  lastCommandAccepted = true;
  lastCommandResultReason = "";
  // คำสั่งรหัสเดิมตอบรับได้โดยไม่ทำงานซ้ำ; จำเฉพาะรหัสล่าสุด ไม่ใช่ประวัติคำสั่งทั้งหมด
  if (commandId == lastHandledCommandId) return commandId;

  if (command == "baseline_recalibrate") {
    lastCommandResultReason = baselineRecalibrationBlockReason();
    if (lastCommandResultReason.length() > 0) {
      lastCommandAccepted = false;
      return commandId;
    }
    if (!clearLearnedBaseline()) {
      lastCommandAccepted = false;
      lastCommandResultReason = "storage_error";
      return commandId;
    }
    saveLastHandledCommandId(commandId);
    return commandId;
  }

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

// printSensorDebug: พิมพ์ค่าจริง ผลต่าง คะแนน ตัวนับ และสถานะใน หน้าต่างแสดงข้อมูลอนุกรม (Serial Monitor) เมื่อเปิด การตรวจหาปัญหา; ใช้ตามเหตุผลการตัดสิน การปิดส่วนนี้ไม่ปิดการตรวจจับ
void printSensorDebug(const SensorData &data, const DeltaData &delta, const EvidenceFlags &e, FireStatus status, int confidence) {
#if SERIAL_DEBUG
  Serial.println("========== SENSOR NODE ==========");
  Serial.print("Node: "); Serial.println(NODE_ID);
  Serial.print("State: "); Serial.println(statusToString(status));
  Serial.print("Confidence: "); Serial.println(confidence);
  Serial.print("Baseline Ready: "); Serial.println(baselineInitialized ? "YES" : "NO");
  Serial.print("Warmup Count: "); Serial.print(baselineWarmupCount); Serial.print("/"); Serial.println(BASELINE_WARMUP_CYCLES);
  Serial.print("Boot Abnormal Count: "); Serial.println(bootAbnormalCount);
  Serial.print("Air Temp: "); Serial.println(data.airTemp);
  Serial.print("Humidity: "); Serial.println(data.humidity);
  Serial.print("Smoke Raw: "); Serial.println(data.smokeRaw);
  Serial.print("Smoke Delta: "); Serial.println(delta.smokeDelta);
  Serial.print("Smoke Rate/min: "); Serial.println(delta.smokeRatePerMin);
  Serial.print("Smoke Baseline Delta: "); Serial.println(delta.smokeBaselineDelta);
  Serial.print("Air Delta: "); Serial.println(delta.airTempDelta);
  Serial.print("Air Rate/min: "); Serial.println(delta.airTempRatePerMin);
  Serial.print("Air Baseline Delta: "); Serial.println(delta.airTempBaselineDelta);
  Serial.print("Humidity Delta: "); Serial.println(delta.humidityDelta);
  Serial.print("Humidity Rate/min: "); Serial.println(delta.humidityRatePerMin);
  Serial.print("Humidity Baseline Delta: "); Serial.println(delta.humidityBaselineDelta);
  Serial.print("Evidence G/S/Hu: "); Serial.print(e.groupCount); Serial.print(" /"); Serial.print(e.smokeGroup); Serial.print("/"); Serial.print(e.heatGroup); Serial.print("/"); Serial.println(e.humidityGroup);
  Serial.print("Baseline Smoke/Air/Humidity: ");
  Serial.print(baselineSmokeRaw); Serial.print(" / ");
  Serial.print(baselineAirTemp); Serial.print(" / ");
  Serial.println(baselineHumidity);
  Serial.print("Critical Candidate Counter: "); Serial.println(criticalCandidateCounter);
  Serial.print("Weak Watch Candidate Counter: "); Serial.println(weakWatchCandidateCounter);
  Serial.print("Latched Status: "); Serial.println(statusToString((FireStatus)latchedStatusValue));
  Serial.print("Release Counter: "); Serial.println(releaseCounter);
  Serial.print("Sensor Health: "); Serial.println(sensorHealthString(data));
  Serial.println("=================================");
#endif
}

// sleepSecondsForStatus: เลือกเวลาหลับตามสถานะในโหมดใช้งานจริง; CRITICAL ถูกแยกให้ตื่นต่อในรอบวัด จึงไม่ได้มีเวลาหลับเฉพาะในฟังก์ชันนี้
uint64_t sleepSecondsForStatus(FireStatus status) {
#if TEST_MODE
  return 0;
#else
  if (status == CALIBRATING) return CALIBRATING_SLEEP_SEC;
  if (status == WATCH) return WATCH_SLEEP_SEC;
  if (status == WARNING) return WARNING_SLEEP_SEC;
  if (status == SENSOR_FAULT) return SENSOR_FAULT_SLEEP_SEC;
  return NORMAL_SLEEP_SEC;
#endif
}

// storeExpectedNextInterval: จำช่วงวัดที่คาดไว้เป็นนาทีใน RTC ก่อนรอ/หลับ เพื่อใช้หารหา อัตราการเปลี่ยนแปลง รอบหน้า; ไม่ใช่การวัดเวลาจริงครบทั้งรอบ
void storeExpectedNextInterval(FireStatus status) {
#if TEST_MODE
  if (status == CRITICAL) expectedNextElapsedMinutes = CRITICAL_CONTINUE_INTERVAL_MS / 60000.0f;
  else expectedNextElapsedMinutes = LOOP_INTERVAL_MS / 60000.0f;
#else
  if (status == CRITICAL) expectedNextElapsedMinutes = CRITICAL_CONTINUE_INTERVAL_MS / 60000.0f;
  else expectedNextElapsedMinutes = sleepSecondsForStatus(status) / 60.0f;
#endif
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

// enterDeepSleepByStatus: เรียกการหลับตามเวลาของสถานะ เฉพาะเมื่อไม่ใช่ TEST_MODE; ในโหมดทดสอบ (void)status แค่บอกว่าจงใจไม่ใช้พารามิเตอร์
void enterDeepSleepByStatus(FireStatus status) {
#if !TEST_MODE
  enterDeepSleepForSeconds(sleepSecondsForStatus(status));
#else
  (void)status;
#endif
}

#if USE_GPS
// serviceGpsUntilNextMeasurementOrSleep: ขณะรอ GPS ให้ปิดไฟเซนเซอร์และบริการ GPS จนถึงรอบวัดถัดไป; ถ้างานจบเร็วจะหลับเฉพาะเวลาที่เหลือแทนเริ่มนับรอบใหม่ทั้งหมด
void serviceGpsUntilNextMeasurementOrSleep(FireStatus status) {
#if !TEST_MODE
  const uint64_t intervalSec = sleepSecondsForStatus(status);
  const unsigned long intervalMs = (unsigned long)(intervalSec * 1000ULL);
  const unsigned long startedAt = millis();

  // จีพีเอสต้องให้ ESP32 ตื่นเพื่อแปลข้อมูล UART ส่วนเซนเซอร์สิ่งแวดล้อม
  // ไม่จำเป็นต้องเปิดไฟหรือส่งค่าซ้ำระหว่างรอให้หาพิกัดได้
  powerSensors(false);
  while (isOneShotGpsActive() && millis() - startedAt < intervalMs) {
    serviceOneShotGps();
    delay(50);
  }

  const unsigned long elapsedMs = millis() - startedAt;
  if (elapsedMs >= intervalMs) return;

  const uint64_t remainingMs = (uint64_t)intervalMs - elapsedMs;
  const uint64_t remainingSec = (remainingMs + 999ULL) / 1000ULL;
  enterDeepSleepForSeconds(remainingSec > 0 ? remainingSec : 1);
#else
  (void)status;
#endif
}
#endif

// sendMeasurement: นำค่าปัจจุบัน ผลต่าง สถานะ และคะแนนมาสร้าง JSON แล้วส่งพร้อมกลไก ACK; ฟังก์ชันนี้ไม่ได้ส่งผลสำเร็จคืนให้ผู้เรียก
void sendMeasurement(const SensorData &current, const DeltaData &delta, FireStatus status, int confidence) {
  String payload = buildJsonPacket(current, delta, status, confidence);
  sendSensorPacketWithAck(payload);
}

// runOneMeasurementCycle: งานหลักหนึ่งรอบ: อ่าน → เรียนฐาน → หาผลต่าง/หลักฐาน/คะแนน → ตัดสิน → ส่ง → ปรับฐาน/จำค่า → รอหรือหลับ; อ่านฟังก์ชันนี้ก่อนเพื่อเห็นภาพรวม
void runOneMeasurementCycle() {
  unsigned long nowMs = millis();
  SensorData current = readSensors();

  // ขั้น 1: สะสมฐานถ้ายังไม่พร้อม จากนั้นใช้ current เทียบ previousData และฐานเพื่อสร้างหลักฐาน/คะแนน/สถานะ
  updateBaselineWarmup(current);
  DeltaData delta = calculateDelta(current, previousData, hasPreviousData, nowMs);
  EvidenceFlags evidence = getEvidenceFlags(current, delta);
  int confidence = calculateConfidence(current, delta, evidence);
  FireStatus status = evaluateFireStatus(current, evidence, confidence);

  // ขั้น 2: เก็บค่าที่ใช้ตรวจคำสั่งก่อนส่ง เพราะระหว่างรอคำตอบ เกตเวย์ อาจสั่งเรียนฐานใหม่
  commandSafetyData = current;
  commandSafetyStatus = status;
  commandSafetyReady = true;

  // ขั้น 3: แสดงเหตุผลใน Serial (ถ้าเปิด) แล้วส่งข้อมูลรอบนี้ออก LoRa
  printSensorDebug(current, delta, evidence, status, confidence);
  sendMeasurement(current, delta, status, confidence);
  // ถ้าเพิ่งรับคำสั่งล้างฐาน เปลี่ยนสถานะภายในหลังส่งเป็น CALIBRATING เพื่อใช้รอบพักสำหรับการเรียนรู้ใหม่
  if (baselineRecalibrationAcceptedThisCycle) {
    status = CALIBRATING;
    baselineRecalibrationAcceptedThisCycle = false;
  }
#if USE_GPS
  serviceOneShotGps();
#endif
  updateBaselineAfterDecision(current, delta, evidence, status);

  // ขั้น 4: จำรอบนี้เป็นรอบก่อนหน้าของการวัดครั้งถัดไป ต้องทำหลังคำนวณผลต่าง มิฉะนั้นจะได้ปัจจุบันลบตัวเองเป็นศูนย์
  previousData = current;
  hasPreviousData = true;
  previousReadMs = nowMs;
  storeExpectedNextInterval(status);

#if TEST_MODE
  if (status == CRITICAL) delayWithBackgroundTasks(CRITICAL_CONTINUE_INTERVAL_MS);
  else delayWithBackgroundTasks(LOOP_INTERVAL_MS);
#else
  // ขั้น 5: วิกฤตให้ตื่นต่อ ส่วน WARNING ตื่นต่อเมื่อเปิดตัวเลือก; การไม่หลับทำให้บริการ GPS ระหว่างรอได้ แต่ใช้พลังงานมากขึ้น
  if (status == CRITICAL || (KEEP_AWAKE_DURING_WARNING && status == WARNING)) {
    const unsigned long activeIntervalMs = status == CRITICAL
      ? CRITICAL_CONTINUE_INTERVAL_MS
      : WARNING_SLEEP_SEC * 1000UL;
    delayWithBackgroundTasks(activeIntervalMs);
  }
#if USE_GPS
  else if (isOneShotGpsActive()) {
    serviceGpsUntilNextMeasurementOrSleep(status);
  }
#endif
  else {
    enterDeepSleepByStatus(status);
  }
#endif
}


// resetRuntimeStateForTestMode: ล้างสถานะ/ตัวนับ RTC เมื่อบูตใน TEST_MODE และสุ่มรหัส รอบการเริ่มเครื่อง ใหม่; ทำให้ทดสอบเริ่มสะอาด ไม่สับสนกับค่าค้างจากครั้งก่อน
void resetRuntimeStateForTestMode() {
#if TEST_MODE
  // ระหว่างทดสอบ ให้เริ่มสถานะใหม่หลังรีเซ็ตหรืออัปโหลด เพื่อไม่ให้ตัวนับเก่าใน RTC
  // เช่น bootAbnormalCount หรือสถานะ SENSOR_FAULT ที่ค้างอยู่ ทำให้สับสนตอนตรวจหาปัญหา
  seq = 0;
  do {
    bootSessionId = esp_random();
  } while (bootSessionId == 0);
  hasPreviousData = false;
  previousReadMs = 0;
  expectedNextElapsedMinutes = 0.0f;
  latchedStatusValue = NORMAL;
  releaseCounter = 0;
  criticalCandidateCounter = 0;
  weakWatchCandidateCounter = 0;
  baselineInitialized = false;
  baselineWarmupCount = 0;
  bootAbnormalCount = 0;
  warmupAirSum = 0.0f;
  warmupHumiditySum = 0.0f;
  warmupSmokeSum = 0;
  baselineAirTemp = 0.0f;
  baselineHumidity = 0.0f;
  baselineSmokeRaw = 0;
  baselineNvsCyclesSinceSave = 0;
#endif
}

// setup: Arduino เรียกครั้งเดียวต่อการเริ่มเครื่อง รวมถึงหลังตื่นจาก การหลับลึก; เปิด การตรวจหาปัญหา เตรียมรหัส โหลดข้อมูล และเริ่มอุปกรณ์ก่อนเข้ารอบวัด
void setup() {
#if SERIAL_DEBUG
  Serial.begin(SERIAL_BAUD);
  delay(1000);
#endif

  resetRuntimeStateForTestMode();

  disableUnusedRadios();
  randomSeed(esp_random());

  if (bootSessionId == 0) {
    do {
      bootSessionId = esp_random();
    } while (bootSessionId == 0);
  }
  loadBaselineFromNvs();
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
