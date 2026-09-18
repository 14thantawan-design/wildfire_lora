#pragma once

/*
  ฟังก์ชันช่วยทั่วไปของ Gateway
  ส่วนนี้จัดการวิทยุที่ไม่ได้ใช้งานก่อนเริ่มระบบหลัก
*/

// disableUnusedRadios: ตั้งโหมด Wi-Fi ตามการใช้งานและปิด Bluetooth ที่ Gateway ไม่ต้องใช้
void disableUnusedRadios() {
#if WIFI_HTTP_ENABLED
  WiFi.mode(WIFI_STA);
#else
  WiFi.mode(WIFI_OFF);
#endif
  btStop();
}
