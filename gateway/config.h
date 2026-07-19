#pragma once

#if __has_include("secrets.h")
  #include "secrets.h"
#else
  #error "Missing gateway/secrets.h. Copy secrets.example.h and fill in this installation's values."
#endif

/*
  Wildfire Early Warning LoRa Gateway - Configuration
  Board target: TTGO / LILYGO LoRa32 ESP32 + SX127x

  Gateway receives packets from multiple sensor nodes.
*/

#define TEST_MODE 1
#define MAX_NODES 10
#define MAX_JSON_SIZE 512

// LoRa config - must match sensor nodes. You said your module is 433 MHz.
#define LORA_FREQUENCY 433E6

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
#define LORA_INIT_RETRY_MS 10000UL

#define SERIAL_BAUD 115200
#define PRINT_RAW_PAYLOAD 1   // useful while testing; set 0 later if too noisy

// =========================
// Backend uplink
// =========================
// Prototype mode:
//   WIFI_HTTP_ENABLED 0 -> Gateway prints LoRa packets to USB Serial.
//   Backend reads that USB port with SERIAL_PORT=COM3.
//
// Field mode:
//   WIFI_HTTP_ENABLED 1 -> Gateway posts packets directly to backend over Wi-Fi.
//   Backend .env should use SERIAL_PORT= because no USB serial bridge is needed.
#define WIFI_HTTP_ENABLED 1
#ifndef BACKEND_ROOT_CA
  #define BACKEND_ROOT_CA ""
#endif
#define BACKEND_NTP_SERVER_PRIMARY "time.cloudflare.com"
#define BACKEND_NTP_SERVER_SECONDARY "pool.ntp.org"
#define BACKEND_TIME_SYNC_TIMEOUT_MS 15000UL
#define BACKEND_MIN_VALID_UNIX_TIME 1700000000UL
#define BACKEND_PACKETS_URL BACKEND_API_BASE_URL "/packets"
#define BACKEND_COMMANDS_PENDING_URL BACKEND_API_BASE_URL "/commands/pending"
#define BACKEND_COMMANDS_URL BACKEND_API_BASE_URL "/commands"
#define WIFI_CONNECT_TIMEOUT_MS 15000UL
#define HTTP_POST_TIMEOUT_MS 5000UL
#define HTTP_POST_RETRY_COUNT 2
#define HTTP_JSON_SIZE 768
#define HTTP_PACKET_QUEUE_LENGTH 20
#define COMMAND_REPORT_QUEUE_LENGTH 10
#define NETWORK_TASK_STACK_SIZE 8192

// Downlink commands are held until the target node sends its next LoRa packet.
#define MAX_PENDING_COMMANDS 10
#define COMMAND_POLL_INTERVAL_MS 2000UL
#define COMMAND_REPEAT_COUNT 3
#define COMMAND_REPEAT_DELAY_MS 80UL
#define COMMAND_HTTP_JSON_SIZE 2048

#if TEST_MODE
  #define OFFLINE_TIMEOUT_MS 60000UL      // 60 sec for bench testing
  #define SUMMARY_PRINT_INTERVAL_MS 10000UL
#else
  #define OFFLINE_TIMEOUT_MS 900000UL     // 15 minutes deploy-like
  #define SUMMARY_PRINT_INTERVAL_MS 60000UL
#endif
