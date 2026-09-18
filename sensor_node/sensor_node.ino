/*
  NODE01 — โปรแกรมโหนดตรวจวัดไฟป่า

  ไฟล์นี้เป็นสารบัญของโปรแกรม จึงตั้งใจให้สั้นและอ่านง่าย
  NODE01 และ NODE02 ใช้ขั้นตอนทำงานชุดเดียวกันจาก sensor_common
  ส่วนค่าที่ต่างกัน เช่น NODE_ID และขาอุปกรณ์ อยู่ใน config.h ของแต่ละโหนด

  ลำดับหลัก:
  setup() เตรียมอุปกรณ์หนึ่งครั้ง
    → loop() เรียกรอบวัด
    → runOneMeasurementCycle() อ่านค่า ประเมินสถานะ ส่ง LoRa และรอรอบถัดไป

  ถ้าต้องการศึกษาแต่ละส่วน ให้เปิดไฟล์ .h ตามรายการ include ด้านล่าง
*/

#include <Arduino.h>          // คำสั่งหลัก Arduino
#include <Wire.h>             // I2C สำหรับ SHT31
#include <SPI.h>              // SPI สำหรับ LoRa
#include <LoRa.h>             // ส่งและรับ LoRa
#include <ArduinoJson.h>      // สร้างและอ่าน JSON
#include <Adafruit_SHT31.h>   // ควบคุม SHT31
#include <WiFi.h>             // ใช้ปิด Wi-Fi เพื่อประหยัดไฟ
#include <Preferences.h>      // เก็บข้อมูลถาวรใน NVS
#include "esp_system.h"       // ฟังก์ชันระบบ ESP32
#include "config.h"           // ค่าของโหนดนี้โดยเฉพาะ

#if USE_GPS
  #include <TinyGPSPlus.h>    // แปลข้อมูลจากโมดูล GPS
#endif

#if defined(BLUETOOTH_ENABLED) || defined(CONFIG_BT_ENABLED)
  #include "esp_bt.h"         // ใช้ปิด Bluetooth เมื่อบอร์ดรองรับ
#endif

// โมดูลร่วมต้อง include ตามลำดับนี้ เพราะส่วนด้านล่างเรียกใช้ส่วนด้านบน
#include "../sensor_common/node_state.h"          // รูปแบบข้อมูลและตัวแปรส่วนกลาง
#include "../sensor_common/node_helpers.h"        // ฟังก์ชันช่วยและ Serial debug
#include "../sensor_common/sensor_reading.h"      // อ่าน SHT31 และ Sharp
#include "../sensor_common/risk_rules.h"          // ประเมิน NORMAL/WATCH/WARNING
#include "../sensor_common/lora_transport.h"      // สร้าง JSON และส่ง LoRa
#include "../sensor_common/gps_service.h"         // ค้นหาและรายงานพิกัด
#include "../sensor_common/gateway_commands.h"    // รับ ACK และคำสั่งจาก Gateway
#include "../sensor_common/power_management.h"    // รอบเวลาและ deep sleep
#include "../sensor_common/node_app.h"            // ขั้นตอนเตรียมโหนดและรอบวัดหลัก

// Arduino เรียก setup() หนึ่งครั้งเมื่อเปิดเครื่อง รีเซ็ต หรือตื่นจาก deep sleep
void setup() {
  setupNode();
}

// Arduino เรียก loop() ซ้ำ โดยแต่ละรอบอ่านค่า ประเมินสถานะ และส่งข้อมูลหนึ่งครั้ง
void loop() {
  runOneMeasurementCycle();
}
