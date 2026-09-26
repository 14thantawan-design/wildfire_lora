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

#define TEST_MODE 0
#define MAX_JSON_SIZE 512

// LoRa config - must match sensor nodes. You said your module is 433 MHz.
#define LORA_FREQUENCY 433E6

#define LORA_SCK   5
#define LORA_MISO  19
#define LORA_MOSI  27
#define LORA_SS    18
#define LORA_RST   14
#define LORA_DIO0  26

#define LORA_SPREADING_FACTOR 12
#define LORA_SIGNAL_BANDWIDTH 125E3
#define LORA_CODING_RATE_DENOMINATOR 5
#define LORA_SYNC_WORD 0x34
#define LORA_TX_POWER_DBM 20
#define LORA_INIT_RETRY_MS 10000UL

// =========================
// Backend uplink
// =========================
// Gateway posts packets directly to the backend over Wi-Fi/HTTP.
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

// Wi-Fi provisioning:
// - First boot: connect a phone to the setup AP and choose the site Wi-Fi.
// - Runtime: hold the TTGO BOOT button to reopen the setup portal.
// - A prolonged outage also opens the portal temporarily while reconnecting.
#define WIFI_CONFIG_BUTTON_PIN 0
#define WIFI_CONFIG_BUTTON_HOLD_MS 5000UL
#define WIFI_SETUP_AP_PREFIX "Wildfire-Gateway"
#define WIFI_PORTAL_AUTO_START_MS 120000UL
#define WIFI_PORTAL_TIMEOUT_MS 600000UL
#define WIFI_CONNECT_TIMEOUT_MS 15000UL
#define HTTP_POST_TIMEOUT_MS 5000UL
#define HTTP_POST_RETRY_COUNT 2
#define HTTP_JSON_SIZE 768
#define COMMAND_REPORT_QUEUE_LENGTH 10
#define NETWORK_TASK_STACK_SIZE 8192

// Downlink commands are held until the target node sends its next LoRa packet.
#define MAX_PENDING_COMMANDS 10
#define COMMAND_POLL_INTERVAL_MS 30000UL
#define COMMAND_REPEAT_COUNT 1  // Retry on the node's next uplink if its command ACK is lost.
#define COMMAND_REPEAT_DELAY_MS 80UL
#define COMMAND_HTTP_JSON_SIZE 2048
