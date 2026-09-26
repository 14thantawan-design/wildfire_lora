#pragma once

/*
  ฟังก์ชันช่วยทั่วไป
  รวมการแปลงชื่อสถานะ การพิมพ์ Serial และการปิดวิทยุที่ไม่ได้ใช้
*/

// =========================
// ฟังก์ชันช่วยทำงานทั่วไป
// =========================
// statusToString: แปลงสถานะชนิด FireStatus เป็นข้อความสำหรับ JSON และหน้าจอ การตรวจหาปัญหา; ถ้าไม่มี ตัวเรียกจะไม่มีตัวแปลงชื่อสถานะ
const char* statusToString(FireStatus status) {
  switch (status) {
    case NORMAL: return "NORMAL";
    case WATCH: return "WATCH";
    case WARNING: return "WARNING";
    case SENSOR_FAULT: return "SENSOR_FAULT";
    default: return "UNKNOWN";
  }
}

// disableUnusedRadios: ปิด Wi-Fi และ Bluetooth ที่โหนดไม่ได้ใช้ เพื่อลดการใช้พลังงาน; การส่งข้อมูลส่วนนี้ใช้ LoRa
void disableUnusedRadios() {
  WiFi.mode(WIFI_OFF);
  btStop();
}
