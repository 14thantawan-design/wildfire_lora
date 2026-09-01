#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include "config.h"

#if defined(BLUETOOTH_ENABLED) || defined(CONFIG_BT_ENABLED)
  #include "esp_bt.h"
#endif

struct AckResult {
  bool received;
  int rssi;
  float snr;
  uint8_t attempt;
};

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET_PIN);

bool displayReady = false;
bool loraReady = false;
unsigned long lastLoRaInitAttemptMs = 0;
unsigned long lastAckMs = 0;
uint32_t sessionId = 0;
uint32_t sequenceNumber = 0;
uint32_t completedCycles = 0;
uint32_t acknowledgedCycles = 0;
bool wireStarted = false;
int activeOledSdaPin = -1;
int activeOledSclPin = -1;

void disableUnusedRadios() {
  WiFi.mode(WIFI_OFF);
#if defined(BLUETOOTH_ENABLED) || defined(CONFIG_BT_ENABLED)
  btStop();
#endif
}

void beginDisplayFrame() {
  if (!displayReady) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("NODE03 RANGE TEST");
}

void finishDisplayFrame() {
  if (displayReady) display.display();
}

void showStartup(const char *message) {
  beginDisplayFrame();
  if (displayReady) {
    display.setCursor(0, 18);
    display.println(message);
  }
  finishDisplayFrame();
}

void showAttempt(uint32_t seq, uint8_t attempt, const char *phase) {
  beginDisplayFrame();
  if (displayReady) {
    display.setCursor(0, 13);
    display.print("SEQ: ");
    display.println(seq);
    display.print("TRY: ");
    display.print(attempt);
    display.print("/");
    display.println(ACK_MAX_ATTEMPTS);
    display.println();
    display.println(phase);
  }
  finishDisplayFrame();
}

const char *linkQuality(const AckResult &result) {
  if (!result.received) return "LOST";
  if (result.rssi >= -90 && result.snr >= 5.0f) return "GOOD";
  if (result.rssi >= -110 && result.snr >= 0.0f) return "FAIR";
  return "WEAK";
}

uint8_t successPercent() {
  if (completedCycles == 0) return 0;
  return (uint8_t)((acknowledgedCycles * 100UL) / completedCycles);
}

void showResult(const AckResult &result) {
  beginDisplayFrame();
  if (displayReady) {
    display.setCursor(0, 11);
    display.print("SEQ ");
    display.print(sequenceNumber);
    display.print(" TRY ");
    display.print(result.attempt);
    display.print("/");
    display.println(ACK_MAX_ATTEMPTS);

    if (result.received) {
      display.print("ACK: OK ");
      display.println(linkQuality(result));
    } else {
      display.println("ACK: LOST");
    }

    if (result.received) {
      display.print("RSSI: ");
      display.print(result.rssi);
      display.println(" dBm");
      display.print("SNR : ");
      display.print(result.snr, 1);
      display.println(" dB");
    } else if (lastAckMs > 0) {
      display.print("LAST OK: ");
      display.print((millis() - lastAckMs) / 1000UL);
      display.println(" sec");
    } else {
      display.println("LAST OK: NEVER");
      display.println();
    }

    display.print("SUCCESS: ");
    display.print(successPercent());
    display.println("%");
  }
  finishDisplayFrame();
}

bool probeDisplayBus(int sdaPin, int sclPin) {
  if (wireStarted) {
    Wire.end();
    wireStarted = false;
    delay(10);
  }
  Serial.print("Probing OLED SDA=");
  Serial.print(sdaPin);
  Serial.print(" SCL=");
  Serial.println(sclPin);
  if (!Wire.begin(sdaPin, sclPin)) return false;
  wireStarted = true;
  Wire.setTimeOut(50);
  Wire.beginTransmission(OLED_I2C_ADDRESS);
  return Wire.endTransmission() == 0;
}

bool selectDisplayBus(int &selectedSda, int &selectedScl) {
  const int candidatePins[][2] = {
    {OLED_PRIMARY_SDA_PIN, OLED_PRIMARY_SCL_PIN},
    {OLED_FALLBACK_SDA_PIN, OLED_FALLBACK_SCL_PIN},
  };

  for (const auto &pins : candidatePins) {
    if (!probeDisplayBus(pins[0], pins[1])) continue;
    selectedSda = pins[0];
    selectedScl = pins[1];
    return true;
  }
  return false;
}

bool initDisplay() {
  int selectedSda = -1;
  int selectedScl = -1;
  if (!selectDisplayBus(selectedSda, selectedScl)) {
    Serial.println("OLED not found on SDA/SCL 4/15 or 21/22");
    return false;
  }

  // Wire already uses the detected pins. periphBegin=false prevents the
  // Adafruit library from calling Wire.begin() again on the default pins.
  displayReady = display.begin(
    SSD1306_SWITCHCAPVCC,
    OLED_I2C_ADDRESS,
    false,
    false
  );
  if (!displayReady) {
    Serial.println("OLED init FAILED");
    return false;
  }
  activeOledSdaPin = selectedSda;
  activeOledSclPin = selectedScl;
  Serial.print("OLED init OK SDA=");
  Serial.print(selectedSda);
  Serial.print(" SCL=");
  Serial.println(selectedScl);
  showStartup("Starting...");
  return true;
}

bool initLoRa() {
  lastLoRaInitAttemptMs = millis();
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    loraReady = false;
    Serial.println("LoRa init FAILED");
    showStartup("LoRa init FAILED");
    return false;
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_SIGNAL_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE_DENOMINATOR);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.setTxPower(LORA_TX_POWER_DBM);
  LoRa.enableCrc();
  LoRa.sleep();

  loraReady = true;
  Serial.println("LoRa init OK");
  showStartup("LoRa ready");
  return true;
}

bool ensureLoRaReady() {
  if (loraReady) return true;
  if (millis() - lastLoRaInitAttemptMs < LORA_INIT_RETRY_MS) return false;
  return initLoRa();
}

String buildTestPacket() {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  sequenceNumber++;
  doc["t"] = "s";
  doc["id"] = NODE_ID;
  doc["q"] = sequenceNumber;
  doc["sid"] = sessionId;
  doc["ri"] = TEST_REPORT_INTERVAL_SEC;
  doc["st"] = "NORMAL";
  doc["c"] = 0;
  doc["at"] = SIMULATED_AIR_TEMP_C;
  doc["h"] = SIMULATED_HUMIDITY_PERCENT;
  doc["sm"] = SIMULATED_SMOKE_RAW;
  doc["sr"] = 0;
  doc["ar"] = 0;
  doc["hr"] = 0;
  doc["sh"] = "OK";

  String payload;
  serializeJson(doc, payload);
  return payload;
}

bool isExpectedAck(const String &payload, uint32_t expectedSeq) {
  StaticJsonDocument<192> doc;
  if (deserializeJson(doc, payload)) return false;
  if (String((const char *)(doc["t"] | "")) != "rx_ack") return false;
  if (String((const char *)(doc["id"] | "")) != NODE_ID) return false;
  if ((uint32_t)(doc["sid"] | 0UL) != sessionId) return false;
  return (uint32_t)(doc["q"] | 0UL) == expectedSeq;
}

bool waitForAck(uint32_t expectedSeq, AckResult &result) {
  const unsigned long startedAt = millis();
  LoRa.receive();

  while (millis() - startedAt < ACK_RX_WINDOW_MS) {
    int packetSize = LoRa.parsePacket();
    if (!packetSize) {
      delay(2);
      continue;
    }

    const int packetRssi = LoRa.packetRssi();
    const float packetSnr = LoRa.packetSnr();
    String payload;
    while (LoRa.available()) payload += (char)LoRa.read();

    if (isExpectedAck(payload, expectedSeq)) {
      result.received = true;
      result.rssi = packetRssi;
      result.snr = packetSnr;
      LoRa.sleep();
      return true;
    }

    LoRa.receive();
  }

  LoRa.sleep();
  return false;
}

bool sendAttempt(const String &payload, AckResult &result) {
  if (!ensureLoRaReady()) return false;

  showAttempt(sequenceNumber, result.attempt, "RANDOM BACKOFF");
  const unsigned long randomDelayMs = random(
    RANDOM_TX_DELAY_MIN_MS,
    RANDOM_TX_DELAY_MAX_MS + 1UL
  );
  delay(randomDelayMs);

  showAttempt(sequenceNumber, result.attempt, "TX + WAIT FOR ACK");
  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  if (!LoRa.endPacket()) {
    LoRa.sleep();
    Serial.println("LoRa TX FAILED");
    return false;
  }

  // Enter receive mode immediately. Serial and OLED work here would make the
  // node miss the short ACK that the Gateway sends as soon as the uplink ends.
  const bool acknowledged = waitForAck(sequenceNumber, result);

  Serial.print("TX NODE03 seq=");
  Serial.print(sequenceNumber);
  Serial.print(" attempt=");
  Serial.print(result.attempt);
  Serial.print(" bytes=");
  Serial.println(payload.length());
  return acknowledged;
}

void runRangeTestCycle() {
  const String payload = buildTestPacket();
  AckResult result = {false, 0, 0.0f, 0};

  for (uint8_t attempt = 1; attempt <= ACK_MAX_ATTEMPTS; attempt++) {
    result.attempt = attempt;
    if (sendAttempt(payload, result)) break;
  }

  completedCycles++;
  if (result.received) {
    acknowledgedCycles++;
    lastAckMs = millis();
    Serial.print("ACK OK seq=");
    Serial.print(sequenceNumber);
    Serial.print(" attempt=");
    Serial.print(result.attempt);
    Serial.print(" RSSI=");
    Serial.print(result.rssi);
    Serial.print(" SNR=");
    Serial.println(result.snr, 2);
  } else {
    Serial.print("ACK LOST seq=");
    Serial.println(sequenceNumber);
  }

  Serial.print("Success cycles: ");
  Serial.print(acknowledgedCycles);
  Serial.print("/");
  Serial.print(completedCycles);
  Serial.print(" (");
  Serial.print(successPercent());
  Serial.println("%)");
  Serial.print("OLED: ");
  if (displayReady) {
    Serial.print("OK SDA=");
    Serial.print(activeOledSdaPin);
    Serial.print(" SCL=");
    Serial.println(activeOledSclPin);
  } else {
    Serial.println("NOT FOUND");
  }

  showResult(result);
  delay(TEST_CYCLE_PAUSE_MS);
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(500);
  Serial.println("NODE03 boot");
  disableUnusedRadios();
  Serial.println("Unused radios disabled");
  randomSeed(esp_random());

  do {
    sessionId = esp_random();
  } while (sessionId == 0);
  Serial.println("Session ready");

  initDisplay();
  Serial.println("Display init finished");
  initLoRa();

  Serial.println("NODE03 LoRa range test ready");
  Serial.println("This firmware never enters deep sleep");
  delay(1000);
}

void loop() {
  runRangeTestCycle();
}
