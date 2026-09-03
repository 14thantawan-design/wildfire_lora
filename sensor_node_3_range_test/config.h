#pragma once

// =========================
// Range-test identity
// =========================
#define NODE_ID "NODE03"
#define MAX_JSON_SIZE 256

// =========================
// LoRa configuration
// Must match the deployed Gateway.
// =========================
#define LORA_FREQUENCY 433E6
#define LORA_SCK 5
#define LORA_MISO 19
#define LORA_MOSI 27
#define LORA_SS 18
#define LORA_RST 14
#define LORA_DIO0 26
#define LORA_SPREADING_FACTOR 12
#define LORA_SIGNAL_BANDWIDTH 125E3
#define LORA_CODING_RATE_DENOMINATOR 5
#define LORA_SYNC_WORD 0x34
#define LORA_TX_POWER_DBM 20
#define LORA_INIT_RETRY_MS 10000UL

// A valid test packet is attempted at most three times. Every attempt uses a
// fresh random delay to reduce collisions with the deployed sensor nodes.
#define ACK_MAX_ATTEMPTS 3
#define ACK_RX_WINDOW_MS 6000UL
#define RANDOM_TX_DELAY_MIN_MS 0UL
#define RANDOM_TX_DELAY_MAX_MS 5000UL
#define TEST_CYCLE_PAUSE_MS 5000UL
#define TEST_REPORT_INTERVAL_SEC 10UL

// =========================
// TTGO LoRa32 OLED
// =========================
#define OLED_WIDTH 128
#define OLED_HEIGHT 64
#define OLED_PRIMARY_SDA_PIN 4
#define OLED_PRIMARY_SCL_PIN 15
#define OLED_FALLBACK_SDA_PIN 21
#define OLED_FALLBACK_SCL_PIN 22
#define OLED_RESET_PIN -1
#define OLED_I2C_ADDRESS 0x3C

// =========================
// Safe simulated sensor data
// =========================
#define SIMULATED_AIR_TEMP_C 28.5f
#define SIMULATED_HUMIDITY_PERCENT 55.0f
#define SIMULATED_SMOKE_RAW 0

#define SERIAL_BAUD 115200
