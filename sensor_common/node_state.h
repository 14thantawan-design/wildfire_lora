#pragma once

/*
  ข้อมูลและสถานะส่วนกลางของโหนด
  ไฟล์นี้ประกาศรูปแบบข้อมูล ออบเจ็กต์อุปกรณ์ และค่าที่ต้องจำข้าม deep sleep
  ฟังก์ชันในโมดูลอื่นจะอ่านหรือปรับตัวแปรเหล่านี้ตามหน้าที่ของตน
*/

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
RTC_DATA_ATTR int latchedStatusValue = NORMAL;
RTC_DATA_ATTR uint8_t releaseCounter = 0;
