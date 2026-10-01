#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <Adafruit_SHT31.h>
#include <WiFi.h>
#include <Preferences.h>
#include "esp_system.h"
#include <esp_sleep.h>
#include "config.h"
#if USE_GPS
#include <TinyGPSPlus.h>
#endif
#if defined(BLUETOOTH_ENABLED) || defined(CONFIG_BT_ENABLED)
#include "esp_bt.h"
#endif
#include "../radio_common/secure_frame.h"
#include "secure_node.h"
#include "../sensor_common/node_state.h"
#include "../sensor_common/node_helpers.h"
#include "../sensor_common/sensor_reading.h"
#include "../sensor_common/risk_rules.h"
#include "../sensor_common/lora_transport.h"
#include "../sensor_common/gps_service.h"
#include "../sensor_common/gateway_commands.h"
#include "../sensor_common/power_management.h"
#include "../sensor_common/node_app.h"

void setup() { setupNode(); }
void loop() { runOneMeasurementCycle(); }
