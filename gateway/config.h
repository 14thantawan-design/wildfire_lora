#pragma once

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

#define SERIAL_BAUD 115200
#define PRINT_RAW_PAYLOAD 1   // useful while testing; set 0 later if too noisy

#if TEST_MODE
  #define OFFLINE_TIMEOUT_MS 60000UL      // 60 sec for bench testing
  #define SUMMARY_PRINT_INTERVAL_MS 10000UL
#else
  #define OFFLINE_TIMEOUT_MS 900000UL     // 15 minutes deploy-like
  #define SUMMARY_PRINT_INTERVAL_MS 60000UL
#endif
