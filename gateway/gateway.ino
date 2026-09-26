/*
  Wildfire LoRa Gateway

  ไฟล์นี้แสดงจุดเริ่มต้นและลูปหลักของ Gateway โดยตรง
  รายละเอียดแต่ละหน้าที่ถูกแยกเป็นไฟล์ .h ตามชื่อเพื่อให้อ่านและค้นหาได้ง่าย
*/

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include "config.h"
#include "wifi_provisioning.h"

#if defined(BLUETOOTH_ENABLED) || defined(CONFIG_BT_ENABLED)
  #include "esp_bt.h"
#endif

// โหลดโมดูลตามลำดับการพึ่งพากัน
#include "gateway_state.h"       // โครงสร้างข้อมูลคำสั่งและสถานะส่วนกลาง
#include "gateway_helpers.h"     // ปิดวิทยุที่ไม่ใช้
#include "backend_http.h"        // Wi-Fi, HTTPS และ Backend
#include "lora_radio.h"          // เริ่มวิทยุ LoRa
#include "gateway_commands.h"    // คิวและการส่งคำสั่งไปโหนด
#include "network_task.h"        // งาน GPS command เบื้องหลังบน FreeRTOS
#include "packet_processing.h"   // รับและส่งต่อแพ็กเก็ต LoRa

// Arduino เรียก setup() หนึ่งครั้งเมื่อเปิดเครื่องหรือรีเซ็ต Gateway
void setup() {
  Serial.begin(115200);
  delay(1000);
  disableUnusedRadios();

  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) pendingCommands[i].used = false;
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) acknowledgedCommandIds[i] = "";

  Serial.println("Starting Wildfire LoRa Gateway ROBUST...");
  Serial.print("Mode: ");
  Serial.println(TEST_MODE ? "TEST_MODE" : "DEPLOY_MODE");
  loraReady = initLoRa();
#if WIFI_HTTP_ENABLED
  beginWifiProvisioning();
  Serial.print("Backend URL: ");
  Serial.println(BACKEND_PACKETS_URL);
  if (!startNetworkTask()) Serial.println("Network task init FAILED");
#endif
}

// Arduino เรียก loop() ซ้ำเพื่อดูแล Wi-Fi กู้ LoRa และรับแพ็กเก็ตจากโหนด
void loop() {
#if WIFI_HTTP_ENABLED
  serviceWifiProvisioning();
#endif
  unsigned long now = millis();
  if (!loraReady && now - lastLoRaInitAttemptMs >= LORA_INIT_RETRY_MS) initLoRa();
  if (loraReady) handleIncomingLoRa();
}
