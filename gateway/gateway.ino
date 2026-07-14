#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "config.h"

#if defined(BLUETOOTH_ENABLED) || defined(CONFIG_BT_ENABLED)
  #include "esp_bt.h"
#endif

struct ParsedPacket {
  String packetType;
  String nodeId;
  uint32_t seq;
  bool gpsFix;
  double latitude;
  double longitude;
  uint8_t satellites;
  float hdop;
  String gpsError;
  String state;
  int confidence;
  float airTemp;
  float humidity;
  float soilTemp;
  bool soilAvailable;
  int smokeRaw;
  int smokeDelta;
  float airTempDelta;
  float soilTempDelta;
  float humidityDelta;
  int smokeBaselineDelta;
  float airTempBaselineDelta;
  float humidityBaselineDelta;
  int groupCount;
  uint16_t baselineWarmupCount;
  float batteryV;
  String sensorHealth;
  String eventId;
};

struct NodeStatus {
  bool used;
  bool offline;
  String nodeId;
  uint32_t lastSeq;
  unsigned long lastSeenMs;
  bool hasLocation;
  bool gpsFix;
  double latitude;
  double longitude;
  uint8_t satellites;
  float hdop;
  String gpsError;
  unsigned long gpsSeenMs;
  String packetType;
  String state;
  int confidence;
  float airTemp;
  float humidity;
  float soilTemp;
  bool soilAvailable;
  int smokeRaw;
  int smokeDelta;
  float airTempDelta;
  float soilTempDelta;
  float humidityDelta;
  int smokeBaselineDelta;
  float airTempBaselineDelta;
  float humidityBaselineDelta;
  int groupCount;
  uint16_t baselineWarmupCount;
  float batteryV;
  String sensorHealth;
  String eventId;
  int rssi;
  float snr;
};

NodeStatus nodes[MAX_NODES];
unsigned long lastSummaryPrintMs = 0;

void disableUnusedRadios() {
#if WIFI_HTTP_ENABLED
  WiFi.mode(WIFI_STA);
#else
  WiFi.mode(WIFI_OFF);
#endif
  btStop();
}

#if WIFI_HTTP_ENABLED
bool ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.print("Connecting Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi connect failed");
    return false;
  }

  Serial.print("Wi-Fi connected: ");
  Serial.println(WiFi.localIP());
  return true;
}

bool postPacketToBackend(const String &payload, int rssi, float snr) {
  if (!ensureWiFiConnected()) return false;

  StaticJsonDocument<HTTP_JSON_SIZE> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("HTTP forward JSON parse error: ");
    Serial.println(error.c_str());
    return false;
  }

  doc["rssi"] = rssi;
  doc["snr"] = snr;

  String body;
  serializeJson(doc, body);

  for (int attempt = 1; attempt <= HTTP_POST_RETRY_COUNT; attempt++) {
    HTTPClient http;
    http.setTimeout(HTTP_POST_TIMEOUT_MS);

    if (!http.begin(BACKEND_PACKETS_URL)) {
      Serial.println("HTTP begin failed");
      http.end();
      continue;
    }

    http.addHeader("Content-Type", "application/json");
    int statusCode = http.POST(body);
    String response = http.getString();
    http.end();

    if (statusCode >= 200 && statusCode < 300) {
      Serial.print("Packet posted to backend: HTTP ");
      Serial.println(statusCode);
      return true;
    }

    Serial.print("Backend POST failed attempt ");
    Serial.print(attempt);
    Serial.print(": HTTP ");
    Serial.print(statusCode);
    if (response.length() > 0) {
      Serial.print(" ");
      Serial.println(response);
    } else {
      Serial.println();
    }

    delay(250);
  }

  return false;
}
#endif

bool initLoRa() {
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.println("LoRa init FAILED");
    return false;
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_SIGNAL_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE_DENOMINATOR);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();
  LoRa.receive();

  Serial.println("LoRa gateway init OK");
  return true;
}

int findNodeIndex(const String &nodeId) {
  for (int i = 0; i < MAX_NODES; i++) {
    if (nodes[i].used && nodes[i].nodeId == nodeId) return i;
  }
  return -1;
}

int getOrCreateNodeIndex(const String &nodeId) {
  int idx = findNodeIndex(nodeId);
  if (idx >= 0) return idx;

  for (int i = 0; i < MAX_NODES; i++) {
    if (!nodes[i].used) {
      nodes[i].used = true;
      nodes[i].offline = false;
      nodes[i].nodeId = nodeId;
      nodes[i].lastSeq = 0;
      nodes[i].lastSeenMs = millis();
      nodes[i].hasLocation = false;
      nodes[i].gpsFix = false;
      nodes[i].latitude = 0.0;
      nodes[i].longitude = 0.0;
      nodes[i].satellites = 0;
      nodes[i].hdop = 0.0f;
      nodes[i].gpsError = "";
      nodes[i].gpsSeenMs = 0;
      nodes[i].state = "UNKNOWN";
      nodes[i].confidence = 0;
      nodes[i].soilAvailable = false;
      nodes[i].groupCount = 0;
      nodes[i].baselineWarmupCount = 0;
      Serial.print("New node registered: ");
      Serial.println(nodeId);
      return i;
    }
  }

  Serial.println("ERROR: MAX_NODES reached, cannot register new node");
  return -1;
}

String normalizePacketType(const String &t) {
  if (t == "c") return "critical";
  if (t == "s") return "sensor";
  return t;
}

template <typename TDoc>
String getStringField(TDoc &doc, const char *compactKey, const char *longKey, const char *fallback) {
  if (!doc[compactKey].isNull()) return String((const char*)doc[compactKey]);
  if (!doc[longKey].isNull()) return String((const char*)doc[longKey]);
  return String(fallback);
}

template <typename TDoc>
int getIntField(TDoc &doc, const char *compactKey, const char *longKey, int fallback) {
  if (!doc[compactKey].isNull()) return doc[compactKey].template as<int>();
  if (!doc[longKey].isNull()) return doc[longKey].template as<int>();
  return fallback;
}

template <typename TDoc>
float getFloatField(TDoc &doc, const char *compactKey, const char *longKey, float fallback) {
  if (!doc[compactKey].isNull()) return doc[compactKey].template as<float>();
  if (!doc[longKey].isNull()) return doc[longKey].template as<float>();
  return fallback;
}

template <typename TDoc>
double getDoubleField(TDoc &doc, const char *compactKey, const char *longKey, double fallback) {
  if (!doc[compactKey].isNull()) return doc[compactKey].template as<double>();
  if (!doc[longKey].isNull()) return doc[longKey].template as<double>();
  return fallback;
}

bool isGpsCoordinateValid(double latitude, double longitude) {
  if (isnan(latitude) || isnan(longitude)) return false;
  if (latitude < -90.0 || latitude > 90.0) return false;
  if (longitude < -180.0 || longitude > 180.0) return false;
  if (fabs(latitude) < 0.000001 && fabs(longitude) < 0.000001) return false;
  return true;
}

bool parseJsonPacket(const String &payload, ParsedPacket &out) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    Serial.print("Raw packet: ");
    Serial.println(payload);
    return false;
  }

  // Supports compact robust packets and older long-key packets.
  out.packetType = normalizePacketType(getStringField(doc, "t", "packet_type", "sensor"));
  out.nodeId = getStringField(doc, "id", "node_id", "");
  out.seq = getIntField(doc, "q", "seq", 0);
  out.gpsFix = getIntField(doc, "gf", "gps_fix", 0) == 1;
  out.latitude = getDoubleField(doc, "la", "lat", 0.0);
  out.longitude = getDoubleField(doc, "ln", "lng", 0.0);
  out.satellites = (uint8_t)getIntField(doc, "sat", "satellites", 0);
  out.hdop = getFloatField(doc, "hd", "hdop", 0.0f);
  out.gpsError = getStringField(doc, "er", "error", "");
  out.state = getStringField(doc, "st", "state", "UNKNOWN");
  out.confidence = getIntField(doc, "c", "confidence", 0);
  out.airTemp = getFloatField(doc, "at", "air_temp", NAN);
  out.humidity = getFloatField(doc, "h", "humidity", NAN);

  out.soilAvailable = false;
  out.soilTemp = getFloatField(doc, "soil", "soil_temp", NAN);
  out.soilAvailable = !isnan(out.soilTemp);

  out.smokeRaw = getIntField(doc, "sm", "smoke_raw", -1);
  out.smokeDelta = getIntField(doc, "sd", "smoke_delta", 0);
  out.airTempDelta = getFloatField(doc, "ad", "air_temp_delta", 0.0f);
  out.soilTempDelta = getFloatField(doc, "sod", "soil_temp_delta", 0.0f);
  out.humidityDelta = getFloatField(doc, "hd", "humidity_delta", 0.0f);

  out.smokeBaselineDelta = getIntField(doc, "sr", "smoke_baseline_delta", 0);
  out.airTempBaselineDelta = getFloatField(doc, "ar", "air_temp_baseline_delta", 0.0f);
  out.humidityBaselineDelta = getFloatField(doc, "hr", "humidity_baseline_delta", 0.0f);
  out.groupCount = getIntField(doc, "g", "groups", 0);
  out.baselineWarmupCount = getIntField(doc, "bc", "baseline_count", 0);

  out.batteryV = getFloatField(doc, "bv", "battery_v", 0.0f);
  out.sensorHealth = getStringField(doc, "sh", "sensor_health", "UNKNOWN");
  out.eventId = getStringField(doc, "eid", "event_id", "");

  if (out.nodeId.length() == 0) {
    Serial.println("ERROR: packet missing node_id/id");
    return false;
  }
  return true;
}

bool isDuplicatePacket(int idx, const ParsedPacket &packet) {
  if (nodes[idx].used && packet.seq == nodes[idx].lastSeq) return true;
  return false;
}

void updateNodeStatus(int idx, const ParsedPacket &packet, int rssi, float snr) {
  nodes[idx].offline = false;
  nodes[idx].lastSeenMs = millis();
  nodes[idx].lastSeq = packet.seq;
  nodes[idx].packetType = packet.packetType;
  nodes[idx].rssi = rssi;
  nodes[idx].snr = snr;

  if (packet.packetType == "gps") {
    nodes[idx].gpsSeenMs = millis();
    nodes[idx].gpsFix = packet.gpsFix && isGpsCoordinateValid(packet.latitude, packet.longitude);
    nodes[idx].satellites = packet.satellites;
    nodes[idx].hdop = packet.hdop;
    nodes[idx].gpsError = packet.gpsError;

    if (nodes[idx].gpsFix) {
      nodes[idx].hasLocation = true;
      nodes[idx].latitude = packet.latitude;
      nodes[idx].longitude = packet.longitude;
      nodes[idx].gpsError = "";
    }
    return;
  }

  nodes[idx].state = packet.state;
  nodes[idx].confidence = packet.confidence;
  nodes[idx].airTemp = packet.airTemp;
  nodes[idx].humidity = packet.humidity;
  nodes[idx].soilTemp = packet.soilTemp;
  nodes[idx].soilAvailable = packet.soilAvailable;
  nodes[idx].smokeRaw = packet.smokeRaw;
  nodes[idx].smokeDelta = packet.smokeDelta;
  nodes[idx].airTempDelta = packet.airTempDelta;
  nodes[idx].soilTempDelta = packet.soilTempDelta;
  nodes[idx].humidityDelta = packet.humidityDelta;
  nodes[idx].smokeBaselineDelta = packet.smokeBaselineDelta;
  nodes[idx].airTempBaselineDelta = packet.airTempBaselineDelta;
  nodes[idx].humidityBaselineDelta = packet.humidityBaselineDelta;
  nodes[idx].groupCount = packet.groupCount;
  nodes[idx].baselineWarmupCount = packet.baselineWarmupCount;
  nodes[idx].batteryV = packet.batteryV;
  nodes[idx].sensorHealth = packet.sensorHealth;
  nodes[idx].eventId = packet.eventId;
}

String calculateAreaStatus() {
  int activeNodes = 0;
  int warningCount = 0;
  int watchCount = 0;
  int calibratingCount = 0;
  int faultOrOfflineCount = 0;

  for (int i = 0; i < MAX_NODES; i++) {
    if (!nodes[i].used) continue;
    activeNodes++;

    if (nodes[i].offline) {
      faultOrOfflineCount++;
      continue;
    }

    if (nodes[i].state == "CRITICAL") return "CRITICAL";
    if (nodes[i].state == "WARNING") warningCount++;
    if (nodes[i].state == "WATCH") watchCount++;
    if (nodes[i].state == "CALIBRATING") calibratingCount++;
    if (nodes[i].state == "SENSOR_FAULT") faultOrOfflineCount++;
  }

  if (warningCount >= 2) return "WARNING_HIGH_CONFIDENCE";
  if (warningCount == 1) return "WARNING";
  if (watchCount >= 1) return "WATCH";
  if (activeNodes > 0 && faultOrOfflineCount == activeNodes) return "NO_HEALTHY_NODES";
  if (faultOrOfflineCount > 0) return "NORMAL_WITH_NODE_ISSUE";
  if (calibratingCount > 0) return "CALIBRATING";
  return "NORMAL";
}

void checkOfflineNodes() {
  unsigned long now = millis();
  for (int i = 0; i < MAX_NODES; i++) {
    if (!nodes[i].used) continue;
    if (now - nodes[i].lastSeenMs > OFFLINE_TIMEOUT_MS) nodes[i].offline = true;
  }
}

void printFloatOrNA(const char *label, float value, bool available = true) {
  Serial.print(label);
  if (!available || isnan(value)) Serial.println("N/A");
  else Serial.println(value);
}

void printLocationOrNA(const NodeStatus &n) {
  Serial.print("  Location: ");
  if (!n.hasLocation) {
    Serial.println("N/A");
    if (n.gpsError.length() > 0) {
      Serial.print("  GPS Error: ");
      Serial.println(n.gpsError);
    }
    return;
  }

  Serial.print(n.latitude, 6);
  Serial.print(", ");
  Serial.println(n.longitude, 6);
  Serial.print("  GPS Sat/HDOP: ");
  Serial.print(n.satellites);
  Serial.print(" / ");
  Serial.println(n.hdop);
  if (n.gpsSeenMs > 0) {
    Serial.print("  GPS Last Seen: ");
    Serial.print((millis() - n.gpsSeenMs) / 1000);
    Serial.println(" sec ago");
  }
}

void printNodeStatus(const NodeStatus &n) {
  Serial.print(n.nodeId);
  Serial.println(n.offline ? " = OFFLINE" : "");
  Serial.print("  State: "); Serial.println(n.offline ? "OFFLINE" : n.state);
  Serial.print("  Confidence: "); Serial.println(n.confidence);
  Serial.print("  Groups: "); Serial.println(n.groupCount);
  Serial.print("  Last Seq: "); Serial.println(n.lastSeq);
  Serial.print("  Last Seen: "); Serial.print((millis() - n.lastSeenMs) / 1000); Serial.println(" sec ago");
  printLocationOrNA(n);
  printFloatOrNA("  Air Temp: ", n.airTemp);
  printFloatOrNA("  Humidity: ", n.humidity);
  printFloatOrNA("  Soil Temp: ", n.soilTemp, n.soilAvailable);
  Serial.print("  Smoke Raw: "); Serial.println(n.smokeRaw);
  Serial.print("  Smoke Delta: "); Serial.println(n.smokeDelta);
  Serial.print("  Air Delta: "); Serial.println(n.airTempDelta);
  Serial.print("  Humidity Delta: "); Serial.println(n.humidityDelta);
  Serial.print("  Smoke From Baseline: "); Serial.println(n.smokeBaselineDelta);
  Serial.print("  Air From Baseline: "); Serial.println(n.airTempBaselineDelta);
  Serial.print("  Humidity From Baseline: "); Serial.println(n.humidityBaselineDelta);
  Serial.print("  Baseline Warmup Count: "); Serial.println(n.baselineWarmupCount);
  Serial.print("  Battery V: "); Serial.println(n.batteryV);
  Serial.print("  Sensor Health: "); Serial.println(n.sensorHealth);
  Serial.print("  Event ID: "); Serial.println(n.eventId);
  Serial.print("  RSSI: "); Serial.println(n.rssi);
  Serial.print("  SNR: "); Serial.println(n.snr);
}

void printAllNodeStatus() {
  checkOfflineNodes();
  Serial.println("========== AREA SUMMARY ==========");
  Serial.print("Area Status: ");
  Serial.println(calculateAreaStatus());
  Serial.println("----------------------------------");

  bool any = false;
  for (int i = 0; i < MAX_NODES; i++) {
    if (!nodes[i].used) continue;
    any = true;
    printNodeStatus(nodes[i]);
    Serial.println("----------------------------------");
  }

  if (!any) Serial.println("No nodes received yet.");
  Serial.println("==================================");
}

void printReceivedPacket(const ParsedPacket &packet, int rssi, float snr) {
  Serial.println("========== RECEIVED PACKET ==========");
  Serial.print("From: "); Serial.println(packet.nodeId);
  Serial.print("Packet Type: "); Serial.println(packet.packetType);
  Serial.print("Seq: "); Serial.println(packet.seq);

  if (packet.packetType == "gps") {
    Serial.print("GPS Fix: "); Serial.println(packet.gpsFix ? "YES" : "NO");
    if (packet.gpsFix && isGpsCoordinateValid(packet.latitude, packet.longitude)) {
      Serial.print("Latitude: "); Serial.println(packet.latitude, 6);
      Serial.print("Longitude: "); Serial.println(packet.longitude, 6);
    } else {
      Serial.print("GPS Error: "); Serial.println(packet.gpsError);
    }
    Serial.print("Satellites: "); Serial.println(packet.satellites);
    Serial.print("HDOP: "); Serial.println(packet.hdop);
    Serial.print("RSSI: "); Serial.println(rssi);
    Serial.print("SNR: "); Serial.println(snr);
    Serial.println("=====================================");
    return;
  }

  Serial.print("State: "); Serial.println(packet.state);
  Serial.print("Confidence: "); Serial.println(packet.confidence);
  Serial.print("Groups: "); Serial.println(packet.groupCount);
  printFloatOrNA("Air Temp: ", packet.airTemp);
  printFloatOrNA("Humidity: ", packet.humidity);
  printFloatOrNA("Soil Temp: ", packet.soilTemp, packet.soilAvailable);
  Serial.print("Smoke Raw: "); Serial.println(packet.smokeRaw);
  Serial.print("Smoke Delta: "); Serial.println(packet.smokeDelta);
  Serial.print("Air Delta: "); Serial.println(packet.airTempDelta);
  Serial.print("Humidity Delta: "); Serial.println(packet.humidityDelta);
  Serial.print("Smoke From Baseline: "); Serial.println(packet.smokeBaselineDelta);
  Serial.print("Air From Baseline: "); Serial.println(packet.airTempBaselineDelta);
  Serial.print("Humidity From Baseline: "); Serial.println(packet.humidityBaselineDelta);
  Serial.print("Baseline Warmup Count: "); Serial.println(packet.baselineWarmupCount);
  Serial.print("Battery V: "); Serial.println(packet.batteryV);
  Serial.print("Sensor Health: "); Serial.println(packet.sensorHealth);
  Serial.print("Event ID: "); Serial.println(packet.eventId);
  Serial.print("RSSI: "); Serial.println(rssi);
  Serial.print("SNR: "); Serial.println(snr);
  Serial.println("=====================================");
}

void handleIncomingLoRa() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;

  String payload;
  while (LoRa.available()) payload += (char)LoRa.read();

  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

#if PRINT_RAW_PAYLOAD
  Serial.print("RAW LoRa bytes=");
  Serial.print(packetSize);
  Serial.print(" payload=");
  Serial.println(payload);
#endif

  ParsedPacket parsed;
  if (!parseJsonPacket(payload, parsed)) return;

  int idx = getOrCreateNodeIndex(parsed.nodeId);
  if (idx < 0) return;

  if (isDuplicatePacket(idx, parsed)) {
    Serial.print("Duplicate packet ignored from ");
    Serial.print(parsed.nodeId);
    Serial.print(" seq=");
    Serial.println(parsed.seq);
    return;
  }

  updateNodeStatus(idx, parsed, rssi, snr);
  printReceivedPacket(parsed, rssi, snr);

#if WIFI_HTTP_ENABLED
  postPacketToBackend(payload, rssi, snr);
#endif
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);
  disableUnusedRadios();

  for (int i = 0; i < MAX_NODES; i++) {
    nodes[i].used = false;
    nodes[i].offline = false;
    nodes[i].soilAvailable = false;
    nodes[i].hasLocation = false;
    nodes[i].gpsFix = false;
    nodes[i].latitude = 0.0;
    nodes[i].longitude = 0.0;
    nodes[i].satellites = 0;
    nodes[i].hdop = 0.0f;
    nodes[i].gpsError = "";
    nodes[i].gpsSeenMs = 0;
  }

  Serial.println("Starting Wildfire LoRa Gateway ROBUST...");
  Serial.print("Mode: ");
  Serial.println(TEST_MODE ? "TEST_MODE" : "DEPLOY_MODE");
#if WIFI_HTTP_ENABLED
  ensureWiFiConnected();
  Serial.print("Backend URL: ");
  Serial.println(BACKEND_PACKETS_URL);
#else
  Serial.println("Backend uplink: USB Serial prototype mode");
#endif
  initLoRa();
}

void loop() {
  handleIncomingLoRa();
  unsigned long now = millis();
  if (now - lastSummaryPrintMs > SUMMARY_PRINT_INTERVAL_MS) {
    lastSummaryPrintMs = now;
    printAllNodeStatus();
  }
}
