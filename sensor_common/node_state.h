#pragma once

/*
  ข้อมูลและสถานะส่วนกลางของโหนด
  ไฟล์นี้ประกาศรูปแบบข้อมูล ออบเจ็กต์อุปกรณ์ และค่าที่ต้องจำข้าม deep sleep
  ฟังก์ชันในโมดูลอื่นจะอ่านหรือปรับตัวแปรเหล่านี้ตามหน้าที่ของตน
*/

// =========================
// โครงสร้างข้อมูล
// =========================
// ชื่อสถานะ; C++ กำหนดเลขภายในให้อัตโนมัติตามลำดับ
enum FireStatus {
  NORMAL,
  WATCH,
  WARNING,
  SENSOR_FAULT
};

// struct รวมค่าที่อ่านหนึ่งรอบ: ค่าควันใช้ ADC ดิบ 12 บิตช่วง 0–4095
struct SensorData {
  float airTemp;
  float humidity;
  int particleAdc;
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
// ออบเจ็กต์สำหรับสั่งเซนเซอร์ผ่านไลบรารี
Adafruit_SHT31 sht31 = Adafruit_SHT31();

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
unsigned long gpsLastAttemptMs = 0;
RTC_DATA_ATTR uint32_t gpsRetryRemainingSec = 0;
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
