#pragma once

/*
  Wildfire Early Warning Sensor Node - Configuration
  Board target: TTGO / LILYGO LoRa32 ESP32 + SX127x

  Robust no-DS18B20 build
  - Primary sensors: SHT31 + Sharp GP2Y1014AU0F
  - DS18B20 disabled by default
  - Adds baseline warm-up, boot-abnormal guard, critical debounce,
    smoke-required critical, Sharp health checks, and slow baseline drift handling.
*/

// =========================
// Mode
// =========================
#define TEST_MODE 1   // 1 = bench test/debug, 0 = deploy-like mode

// =========================
// Node identity
// =========================
#define NODE_ID "NODE01"     // Change to NODE02 on the second sensor node
#define MAX_JSON_SIZE 384     // compact JSON should remain < 255 LoRa bytes

// =========================
// Optional sensors
// =========================
#define USE_DS18B20 0         // keep 0 if you are not using DS18B20
#define USE_GPS 1             // GPS TX -> GPS_RX_PIN; GPS fix is sent as a separate LoRa packet

// =========================
// LoRa config
// =========================
#define LORA_FREQUENCY 433E6  // must match Gateway and your 433 MHz module/antenna

#define LORA_SCK   5
#define LORA_MISO  19
#define LORA_MOSI  27
#define LORA_SS    18
#define LORA_RST   14
#define LORA_DIO0  26

#define LORA_SPREADING_FACTOR 7
#define LORA_SIGNAL_BANDWIDTH 125E3
#define LORA_CODING_RATE_DENOMINATOR 5
#define LORA_SYNC_WORD 0x34
#define LORA_TX_POWER_DBM 17

#define RANDOM_TX_DELAY_MIN_MS 0
#define RANDOM_TX_DELAY_MAX_MS 5000

// =========================
// Sensor pins
// =========================
#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 22
#define SHT31_I2C_ADDRESS_PRIMARY 0x44
#define SHT31_I2C_ADDRESS_SECONDARY 0x45
#define DS18B20_PIN 13       // ignored when USE_DS18B20 = 0
#define SHARP_LED_PIN 25
#define SHARP_ANALOG_PIN 36

#define SENSOR_POWER_PIN -1
#define BATTERY_ADC_PIN -1
#define BATTERY_DIVIDER_RATIO 2.0f

// =========================
// One-shot GPS install location
// =========================
// Ublox NEO-6M one-way mode: GPS TX -> ESP32 GPIO34. GPS RX must be left unconnected.
// GPIO34 is input-only, so it is OK for GPS TX into ESP32 but cannot transmit.
// This TTGO/ESP32-PICO-D4 maps embedded flash onto GPIO16/GPIO17, so never use GPIO17 for GPS TX.
// GPS_POWER_PIN must drive a MOSFET/load-switch/EN pin, not GPS VCC directly.
// If GPS VCC is wired directly to 5V/3V3 with no power switch, set GPS_POWER_PIN to -1.
// If the GPS module is not connected yet and no NVS location exists, GPS runs
// in the background while normal fire detection continues.
#define GPS_RX_PIN 34
#define GPS_TX_PIN -1
#define GPS_BAUD 9600
#define GPS_POWER_PIN -1
#define GPS_FIX_TIMEOUT_MS 180000UL
#define GPS_MIN_SATELLITES 4
#define GPS_SAVE_TO_NVS 1
#define GPS_FORCE_RECALIBRATE 0
#define GPS_PACKET_REPEAT_COUNT 3
#define GPS_ACTIVE_LOOP_DELAY_MS 5000UL

// =========================
// Timing
// =========================
#if TEST_MODE
  #define LOOP_INTERVAL_MS 5000UL
#else
  #define NORMAL_SLEEP_SEC 600UL
  #define WATCH_SLEEP_SEC 120UL
  #define WARNING_SLEEP_SEC 60UL
  #define CALIBRATING_SLEEP_SEC 30UL
  #define SENSOR_FAULT_SLEEP_SEC 300UL
#endif

#define CRITICAL_BURST_COUNT 3
#define CRITICAL_CONTINUE_INTERVAL_MS 20000UL

// =========================
// Baseline warm-up and calibration
// =========================
#if TEST_MODE
  #define BASELINE_WARMUP_CYCLES 5       // 5 cycles x 5 sec = about 25 sec
#else
  #define BASELINE_WARMUP_CYCLES 12      // safer for field startup
#endif

// If power-up readings look abnormal, do not learn them as "normal" baseline.
#define BOOT_ABNORMAL_REQUIRED_CYCLES 2
#define BASELINE_EMA_ALPHA 0.05f
#define BASELINE_WATCH_NO_SMOKE_ALPHA 0.01f

// =========================
// Sensor health checks
// =========================
// Some GP2Y1014 circuits can read near 0 in very clean air.
// Therefore low/stuck readings are treated as diagnostics by default, not fatal faults.
// Enable SHARP_LOW_FAULT_ENABLED only after you confirm your Sharp sensor normally never reads 0.
#define SHARP_MIN_VALID_RAW 2
#define SHARP_MAX_VALID_RAW 4092
#define SHARP_BAD_STREAK_LIMIT 3
#define SHARP_STUCK_EPS 1
#define SHARP_STUCK_STREAK_LIMIT 40
#define SHARP_LOW_FAULT_ENABLED 0
#define SHARP_HIGH_FAULT_ENABLED 1
#define SHARP_STUCK_FAULT_ENABLED 0

#define SHT31_MIN_TEMP_C -20.0f
#define SHT31_MAX_TEMP_C 85.0f
#define SHT31_MIN_HUMIDITY 0.0f
#define SHT31_MAX_HUMIDITY 100.0f

// =========================
// Fire logic thresholds - tune after measuring your real sensor values
// =========================
// Previous-step delta is normalized into rate per minute so TEST_MODE and DEPLOY_MODE behave similarly.
#define SMOKE_RATE_WATCH_PER_MIN 300
#define SMOKE_RATE_WARNING_PER_MIN 800
#define SMOKE_RATE_CRITICAL_PER_MIN 1500

#define AIR_TEMP_RATE_WATCH_PER_MIN 0.30f
#define AIR_TEMP_RATE_WARNING_PER_MIN 0.70f
#define AIR_TEMP_RATE_CRITICAL_PER_MIN 1.20f

#define HUMIDITY_DROP_RATE_WATCH_PER_MIN 1.0f
#define HUMIDITY_DROP_RATE_WARNING_PER_MIN 2.0f
#define HUMIDITY_DROP_RATE_CRITICAL_PER_MIN 4.0f

// Ignore tiny previous-step movement before converting it into a per-minute rate.
// This is important in TEST_MODE, where a small 5-second sensor wobble can look large after normalization.
#define SMOKE_RATE_MIN_DELTA_RAW 40
#define AIR_TEMP_RATE_MIN_DELTA_C 0.20f
#define HUMIDITY_DROP_RATE_MIN_DELTA 0.60f

// Sustained baseline difference catches values that remain high after the first jump.
#define SMOKE_BASELINE_WATCH 150
#define SMOKE_BASELINE_WARNING 450
#define SMOKE_BASELINE_CRITICAL 900

#define SMOKE_RAW_WATCH_MIN 250
#define SMOKE_RAW_WARNING 1200
#define SMOKE_RAW_CRITICAL 1800

#define AIR_TEMP_BASELINE_WATCH 2.0f
#define AIR_TEMP_BASELINE_WARNING 4.0f
#define AIR_TEMP_BASELINE_CRITICAL 6.0f

#define AIR_TEMP_ABSOLUTE_WARNING 40.0f
#define AIR_TEMP_ABSOLUTE_CRITICAL 50.0f

#define HUMIDITY_LOW 45.0f
#define HUMIDITY_VERY_LOW 35.0f
#define HUMIDITY_HIGH_FOG_LIKE 90.0f

#define HUMIDITY_BASELINE_DROP_WATCH 5.0f
#define HUMIDITY_BASELINE_DROP_WARNING 10.0f
#define HUMIDITY_BASELINE_DROP_CRITICAL 15.0f

// DS18B20 optional thresholds, ignored when USE_DS18B20 = 0.
#define SOIL_TEMP_DELTA_WARNING 2.0f
#define SOIL_TEMP_DELTA_CRITICAL 4.0f

// =========================
// State logic safety rules
// =========================
#define WARNING_CONFIDENCE 55
#define CRITICAL_CONFIDENCE 70

// Critical must be confirmed by consecutive cycles to avoid one-sample spikes.
#define CRITICAL_CONFIRM_CYCLES 2

// Weak heat+humidity WATCH without smoke must persist before entering WATCH.
#define WATCH_ENV_CONFIRM_CYCLES 2

// With DS18B20 removed, require smoke/particle evidence for CRITICAL.
#define REQUIRE_SMOKE_FOR_CRITICAL 1

// Hold WARNING/CRITICAL for a few clean cycles before downgrading.
#define STATUS_RELEASE_CYCLES 3
#define WARNING_RELEASE_CONFIDENCE 25
#define CRITICAL_RELEASE_CONFIDENCE 45

// Fog/dew condition can reduce weak smoke confidence, but should not suppress strong smoke.
#define FOG_PENALTY_SCORE 20

// Keep LoRa payload below a safe size for SX127x packet mode.
#define MAX_SAFE_PAYLOAD_BYTES 240

// =========================
// Debug
// =========================
#if TEST_MODE
  #define SERIAL_DEBUG 1
#else
  #define SERIAL_DEBUG 0
#endif

#define SERIAL_BAUD 115200
