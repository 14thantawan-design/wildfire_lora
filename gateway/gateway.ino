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

struct ParsedPacket {
  String packetType;
  String nodeId;
  uint32_t seq;
  uint32_t sessionId;
  uint32_t reportIntervalSec;
  bool gpsFix;
  double latitude;
  double longitude;
  String gpsError;
  String state;
  uint16_t riskReasonBits;
  float airTemp;
  float humidity;
  float particleUgM3;
  String sensorHealth;
};

struct NodeStatus {
  bool used;
  bool offline;
  String nodeId;
  uint32_t lastSeq;
  uint32_t lastSessionId;
  uint32_t reportIntervalSec;
  unsigned long lastSeenMs;
  bool hasLocation;
  bool gpsFix;
  double latitude;
  double longitude;
  String gpsError;
  unsigned long gpsSeenMs;
  String state;
  uint16_t riskReasonBits;
  float airTemp;
  float humidity;
  float particleUgM3;
  String sensorHealth;
  int rssi;
  float snr;
};

struct PendingCommand {
  bool used;
  String commandId;
  String nodeId;
  String command;
};

enum CommandReportType : uint8_t {
  COMMAND_REPORT_SENT,
  COMMAND_REPORT_ACK,
  COMMAND_REPORT_REJECT
};

#if WIFI_HTTP_ENABLED
struct HttpPacketJob {
  char payload[MAX_JSON_SIZE + 1];
  int rssi;
  float snr;
  uint8_t attempts;
};

struct CommandReportJob {
  CommandReportType type;
  char commandId[64];
  char nodeId[33];
  char reason[32];
  uint8_t attempts;
};
#endif

NodeStatus nodes[MAX_NODES];
PendingCommand pendingCommands[MAX_PENDING_COMMANDS];
String acknowledgedCommandIds[MAX_PENDING_COMMANDS];
uint8_t nextAcknowledgedCommandIndex = 0;
unsigned long lastSummaryPrintMs = 0;
unsigned long lastCommandPollMs = 0;
unsigned long lastLoRaInitAttemptMs = 0;
bool loraReady = false;

#if WIFI_HTTP_ENABLED
QueueHandle_t httpPacketQueue = nullptr;
QueueHandle_t commandReportQueue = nullptr;
SemaphoreHandle_t pendingCommandMutex = nullptr;
#endif

void clearPendingCommand(const String &commandId, const String &nodeId);

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

  // The provisioning service owns WiFi.begin() and reconnect scheduling.
  // This task only waits briefly so LoRa reception can continue on the other core.
  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
  }

  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }
  return true;
}

bool ensureBackendClock() {
  if ((uint32_t)time(nullptr) >= BACKEND_MIN_VALID_UNIX_TIME) return true;

  configTime(
    0,
    0,
    BACKEND_NTP_SERVER_PRIMARY,
    BACKEND_NTP_SERVER_SECONDARY
  );
  unsigned long startedAt = millis();
  while ((uint32_t)time(nullptr) < BACKEND_MIN_VALID_UNIX_TIME &&
         millis() - startedAt < BACKEND_TIME_SYNC_TIMEOUT_MS) {
    delay(250);
  }

  if ((uint32_t)time(nullptr) < BACKEND_MIN_VALID_UNIX_TIME) {
    Serial.println("HTTPS clock sync failed");
    return false;
  }
  return true;
}

bool beginBackendHttp(
  HTTPClient &http,
  NetworkClientSecure &secureClient,
  const String &url
) {
  if (!url.startsWith("https://")) return http.begin(url);

  if (strlen(BACKEND_ROOT_CA) < 100) {
    Serial.println("HTTPS root CA is not configured");
    return false;
  }
  if (!ensureBackendClock()) return false;

  secureClient.setCACert(BACKEND_ROOT_CA);
  return http.begin(secureClient, url);
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
    NetworkClientSecure secureClient;
    http.setTimeout(HTTP_POST_TIMEOUT_MS);

    if (!beginBackendHttp(http, secureClient, BACKEND_PACKETS_URL)) {
      Serial.println("HTTP begin failed");
      http.end();
      continue;
    }

    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Gateway-Key", GATEWAY_API_KEY);
    int statusCode = http.POST(body);
    String httpError = statusCode < 0 ? http.errorToString(statusCode) : "";
    char tlsErrorBuffer[160] = {0};
    int tlsErrorCode = secureClient.lastError(tlsErrorBuffer, sizeof(tlsErrorBuffer));
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
    if (httpError.length() > 0) {
      Serial.print(" ");
      Serial.print(httpError);
    }
    if (tlsErrorCode != 0) {
      Serial.print(" TLS ");
      Serial.print(tlsErrorCode);
      Serial.print(": ");
      Serial.print(tlsErrorBuffer);
    }
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

bool postCommandAck(const String &commandId, bool accepted, const String &reason) {
  if (!ensureWiFiConnected()) return false;

  HTTPClient http;
  NetworkClientSecure secureClient;
  http.setTimeout(HTTP_POST_TIMEOUT_MS);
  String url = String(BACKEND_COMMANDS_URL) + "/" + commandId + "/ack";
  if (!beginBackendHttp(http, secureClient, url)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Gateway-Key", GATEWAY_API_KEY);
  StaticJsonDocument<128> doc;
  doc["accepted"] = accepted;
  if (!accepted && reason.length() > 0) doc["reason"] = reason;
  String body;
  serializeJson(doc, body);
  int statusCode = http.POST(body);
  http.end();
  return statusCode >= 200 && statusCode < 300;
}

bool postCommandSent(const String &commandId) {
  if (!ensureWiFiConnected()) return false;

  HTTPClient http;
  NetworkClientSecure secureClient;
  http.setTimeout(HTTP_POST_TIMEOUT_MS);
  String url = String(BACKEND_COMMANDS_URL) + "/" + commandId + "/sent";
  if (!beginBackendHttp(http, secureClient, url)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Gateway-Key", GATEWAY_API_KEY);
  int statusCode = http.POST("{}");
  http.end();
  return statusCode >= 200 && statusCode < 300;
}
#endif

bool initLoRa() {
  lastLoRaInitAttemptMs = millis();
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    loraReady = false;
    Serial.println("LoRa init FAILED");
    return false;
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_SIGNAL_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE_DENOMINATOR);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.setTxPower(LORA_TX_POWER_DBM);
  LoRa.enableCrc();
  LoRa.receive();

  Serial.print("LoRa gateway init OK SF=");
  Serial.print(LORA_SPREADING_FACTOR);
  Serial.print(" TX=");
  Serial.print(LORA_TX_POWER_DBM);
  Serial.println(" dBm");
  loraReady = true;
  return true;
}

void lockPendingCommands() {
#if WIFI_HTTP_ENABLED
  if (pendingCommandMutex) xSemaphoreTake(pendingCommandMutex, portMAX_DELAY);
#endif
}

void unlockPendingCommands() {
#if WIFI_HTTP_ENABLED
  if (pendingCommandMutex) xSemaphoreGive(pendingCommandMutex);
#endif
}

bool hasPendingCommandUnlocked(const String &commandId) {
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (pendingCommands[i].used && pendingCommands[i].commandId == commandId) return true;
  }
  return false;
}

bool wasCommandAcknowledgedUnlocked(const String &commandId) {
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (acknowledgedCommandIds[i] == commandId) return true;
  }
  return false;
}

bool queuePendingCommand(const String &commandId, const String &nodeId, const String &command) {
  if (commandId.length() == 0 || nodeId.length() == 0 || command.length() == 0) return false;
  lockPendingCommands();
  if (wasCommandAcknowledgedUnlocked(commandId)) {
    unlockPendingCommands();
    return true;
  }
  if (hasPendingCommandUnlocked(commandId)) {
    unlockPendingCommands();
    return true;
  }

  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (!pendingCommands[i].used) {
      pendingCommands[i].used = true;
      pendingCommands[i].commandId = commandId;
      pendingCommands[i].nodeId = nodeId;
      pendingCommands[i].command = command;
      Serial.print("Command queued: ");
      Serial.print(command);
      Serial.print(" -> ");
      Serial.println(nodeId);
      unlockPendingCommands();
      return true;
    }
  }

  unlockPendingCommands();
  Serial.println("Command queue full");
  return false;
}

bool serverStillHasCommand(JsonArray serverCommands, const String &commandId) {
  for (JsonObject command : serverCommands) {
    if (String((const char *)(command["command_id"] | "")) == commandId) return true;
  }
  return false;
}

void reconcilePendingCommands(JsonArray serverCommands) {
  lockPendingCommands();
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (!pendingCommands[i].used) continue;
    if (!serverStillHasCommand(serverCommands, pendingCommands[i].commandId)) {
      pendingCommands[i].used = false;
    }
  }
  unlockPendingCommands();
}

#if WIFI_HTTP_ENABLED
void pollBackendCommands() {
  if (!ensureWiFiConnected()) return;

  HTTPClient http;
  NetworkClientSecure secureClient;
  http.setTimeout(HTTP_POST_TIMEOUT_MS);
  if (!beginBackendHttp(http, secureClient, BACKEND_COMMANDS_PENDING_URL)) return;

  http.addHeader("X-Gateway-Key", GATEWAY_API_KEY);
  int statusCode = http.GET();
  String response = http.getString();
  http.end();
  if (statusCode != 200 || response.length() == 0) return;

  StaticJsonDocument<COMMAND_HTTP_JSON_SIZE> doc;
  if (deserializeJson(doc, response)) return;

  JsonArray serverCommands = doc.as<JsonArray>();
  if (serverCommands.isNull()) return;
  reconcilePendingCommands(serverCommands);

  for (JsonObject command : serverCommands) {
    queuePendingCommand(
      String((const char *)(command["command_id"] | "")),
      String((const char *)(command["node_id"] | "")),
      String((const char *)(command["command"] | ""))
    );
  }
}

bool enqueuePacketForBackend(const String &payload, int rssi, float snr) {
  if (!httpPacketQueue || payload.length() > MAX_JSON_SIZE) return false;
  HttpPacketJob job = {};
  strlcpy(job.payload, payload.c_str(), sizeof(job.payload));
  job.rssi = rssi;
  job.snr = snr;
  return xQueueSend(httpPacketQueue, &job, 0) == pdTRUE;
}

void processCommandReport(CommandReportJob &job) {
  bool posted = job.type == COMMAND_REPORT_SENT
    ? postCommandSent(String(job.commandId))
    : postCommandAck(
        String(job.commandId),
        job.type == COMMAND_REPORT_ACK,
        String(job.reason)
      );

  if (posted) {
    if (job.type != COMMAND_REPORT_SENT) {
      clearPendingCommand(String(job.commandId), String(job.nodeId));
    }
    return;
  }

  if (job.attempts < 4) {
    job.attempts++;
    xQueueSend(commandReportQueue, &job, 0);
  }
}

void networkTask(void *parameter) {
  (void)parameter;
  HttpPacketJob pendingPacket = {};
  bool hasPendingPacket = false;

  for (;;) {
    CommandReportJob report;
    if (xQueueReceive(commandReportQueue, &report, 0) == pdTRUE) {
      processCommandReport(report);
    }

    if (!hasPendingPacket && xQueueReceive(httpPacketQueue, &pendingPacket, 0) == pdTRUE) {
      hasPendingPacket = true;
    }

    if (hasPendingPacket) {
      if (postPacketToBackend(String(pendingPacket.payload), pendingPacket.rssi, pendingPacket.snr)) {
        hasPendingPacket = false;
      } else if (pendingPacket.attempts < 2) {
        // Keep retrying the same packet instead of moving it to the queue tail.
        // This prevents old seq values from arriving after newer live readings.
        pendingPacket.attempts++;
      } else {
        hasPendingPacket = false;
      }
    }

    unsigned long now = millis();
    if (now - lastCommandPollMs >= COMMAND_POLL_INTERVAL_MS) {
      lastCommandPollMs = now;
      pollBackendCommands();
    }

    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

bool startNetworkTask() {
  httpPacketQueue = xQueueCreate(HTTP_PACKET_QUEUE_LENGTH, sizeof(HttpPacketJob));
  commandReportQueue = xQueueCreate(COMMAND_REPORT_QUEUE_LENGTH, sizeof(CommandReportJob));
  pendingCommandMutex = xSemaphoreCreateMutex();
  if (!httpPacketQueue || !commandReportQueue || !pendingCommandMutex) return false;

  return xTaskCreatePinnedToCore(
    networkTask,
    "gateway_network",
    NETWORK_TASK_STACK_SIZE,
    nullptr,
    1,
    nullptr,
    0
  ) == pdPASS;
}
#endif

bool queueCommandReport(
  CommandReportType type,
  const String &commandId,
  const String &nodeId,
  const String &reason = ""
) {
#if WIFI_HTTP_ENABLED
  if (!commandReportQueue) return false;
  CommandReportJob job = {};
  job.type = type;
  strlcpy(job.commandId, commandId.c_str(), sizeof(job.commandId));
  strlcpy(job.nodeId, nodeId.c_str(), sizeof(job.nodeId));
  strlcpy(job.reason, reason.c_str(), sizeof(job.reason));
  return xQueueSend(commandReportQueue, &job, 0) == pdTRUE;
#else
  (void)type;
  (void)commandId;
  (void)nodeId;
  return false;
#endif
}

bool markPendingCommandSent(const String &commandId, const String &nodeId) {
#if WIFI_HTTP_ENABLED
  return queueCommandReport(COMMAND_REPORT_SENT, commandId, nodeId);
#else
  Serial.print("CMD_SENT ");
  Serial.println(commandId);
  return true;
#endif
}

bool acknowledgePendingCommand(
  const String &commandId,
  const String &nodeId,
  bool accepted,
  const String &reason
) {
#if WIFI_HTTP_ENABLED
  return queueCommandReport(
    accepted ? COMMAND_REPORT_ACK : COMMAND_REPORT_REJECT,
    commandId,
    nodeId,
    reason
  );
#else
  Serial.print(accepted ? "CMD_ACK " : "CMD_REJECT ");
  Serial.println(commandId);
  return true;
#endif
}

int findPendingCommandIndexUnlocked(const String &commandId, const String &nodeId) {
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (pendingCommands[i].used &&
        pendingCommands[i].commandId == commandId &&
        pendingCommands[i].nodeId == nodeId) return i;
  }
  return -1;
}

bool hasPendingCommandForNode(const String &commandId, const String &nodeId) {
  lockPendingCommands();
  bool found = findPendingCommandIndexUnlocked(commandId, nodeId) >= 0;
  unlockPendingCommands();
  return found;
}

void clearPendingCommand(const String &commandId, const String &nodeId) {
  lockPendingCommands();
  int index = findPendingCommandIndexUnlocked(commandId, nodeId);
  if (index >= 0) pendingCommands[index].used = false;
  unlockPendingCommands();
}

void clearAndRememberAcknowledgedCommand(const String &commandId, const String &nodeId) {
  lockPendingCommands();
  int index = findPendingCommandIndexUnlocked(commandId, nodeId);
  if (index >= 0) pendingCommands[index].used = false;
  acknowledgedCommandIds[nextAcknowledgedCommandIndex] = commandId;
  nextAcknowledgedCommandIndex =
    (nextAcknowledgedCommandIndex + 1) % MAX_PENDING_COMMANDS;
  unlockPendingCommands();
}

bool sendPendingCommandForNode(const String &nodeId) {
  String commandId;
  String commandName;
  lockPendingCommands();
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (!pendingCommands[i].used || pendingCommands[i].nodeId != nodeId) continue;
    commandId = pendingCommands[i].commandId;
    commandName = pendingCommands[i].command;
    break;
  }
  unlockPendingCommands();
  if (commandId.length() == 0) return false;

  StaticJsonDocument<MAX_JSON_SIZE> doc;
  doc["t"] = "cmd";
  doc["id"] = nodeId;
  doc["cmd"] = commandName;
  doc["cid"] = commandId;
  String payload;
  serializeJson(doc, payload);

  LoRa.idle();
  bool sent = true;
  for (int repeat = 0; repeat < COMMAND_REPEAT_COUNT; repeat++) {
    LoRa.beginPacket();
    LoRa.print(payload);
    sent = LoRa.endPacket() && sent;
    if (repeat + 1 < COMMAND_REPEAT_COUNT) delay(COMMAND_REPEAT_DELAY_MS);
  }
  LoRa.receive();
  if (!sent) return false;

  Serial.print("Command sent: ");
  Serial.print(commandName);
  Serial.print(" -> ");
  Serial.println(nodeId);
  if (!markPendingCommandSent(commandId, nodeId)) {
    Serial.print("Command sent status queue full: ");
    Serial.println(commandId);
  }
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
      nodes[i].lastSessionId = 0;
      nodes[i].reportIntervalSec = 0;
      nodes[i].lastSeenMs = millis();
      nodes[i].hasLocation = false;
      nodes[i].gpsFix = false;
      nodes[i].latitude = 0.0;
      nodes[i].longitude = 0.0;
      nodes[i].gpsError = "";
      nodes[i].gpsSeenMs = 0;
      nodes[i].state = "UNKNOWN";
      nodes[i].riskReasonBits = 0;
      Serial.print("New node registered: ");
      Serial.println(nodeId);
      return i;
    }
  }

  Serial.println("ERROR: MAX_NODES reached, cannot register new node");
  return -1;
}

String normalizePacketType(const String &t) {
  if (t == "c") return "sensor"; // รองรับแพ็กเก็ตเก่าที่ใช้ c แยกชนิด CRITICAL
  if (t == "s") return "sensor";
  return t;
}

String normalizeRiskState(String state) {
  state.trim();
  state.toUpperCase();
  if (state == "CRITICAL") return "WARNING";
  if (state == "CALIBRATING") return "UNKNOWN";
  if (state == "NORMAL" || state == "WATCH" ||
      state == "WARNING" || state == "SENSOR_FAULT") return state;
  return "UNKNOWN";
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
uint32_t getUIntField(TDoc &doc, const char *compactKey, const char *longKey, uint32_t fallback) {
  if (!doc[compactKey].isNull()) return doc[compactKey].template as<uint32_t>();
  if (!doc[longKey].isNull()) return doc[longKey].template as<uint32_t>();
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
  out.seq = getUIntField(doc, "q", "seq", 0);
  out.sessionId = getUIntField(doc, "sid", "session_id", 0);
  out.reportIntervalSec = getUIntField(doc, "ri", "report_interval_sec", 0);
  out.gpsFix = getIntField(doc, "gf", "gps_fix", 0) == 1;
  out.latitude = getDoubleField(doc, "la", "lat", 0.0);
  out.longitude = getDoubleField(doc, "ln", "lng", 0.0);
  out.gpsError = getStringField(doc, "er", "error", "");
  out.state = normalizeRiskState(getStringField(doc, "st", "state", "UNKNOWN"));
  out.riskReasonBits = getIntField(doc, "rb", "risk_reason_bits", 0);
  out.airTemp = getFloatField(doc, "at", "air_temp", NAN);
  out.humidity = getFloatField(doc, "h", "humidity", NAN);

  out.particleUgM3 = getFloatField(doc, "pm", "particle_ug_m3", NAN);
  out.sensorHealth = getStringField(doc, "sh", "sensor_health", "UNKNOWN");

  if (out.nodeId.length() == 0) {
    Serial.println("ERROR: packet missing node_id/id");
    return false;
  }
  return true;
}

bool isDuplicatePacket(int idx, const ParsedPacket &packet) {
  return nodes[idx].used && packet.sessionId != 0 &&
         nodes[idx].lastSessionId == packet.sessionId &&
         packet.seq <= nodes[idx].lastSeq;
}

void updateNodeStatus(int idx, const ParsedPacket &packet, int rssi, float snr) {
  nodes[idx].offline = false;
  nodes[idx].lastSeenMs = millis();
  nodes[idx].lastSeq = packet.seq;
  nodes[idx].lastSessionId = packet.sessionId;
  if (packet.reportIntervalSec > 0) nodes[idx].reportIntervalSec = packet.reportIntervalSec;
  nodes[idx].rssi = rssi;
  nodes[idx].snr = snr;

  if (packet.packetType == "gps") {
    nodes[idx].gpsSeenMs = millis();
    nodes[idx].gpsFix = packet.gpsFix && isGpsCoordinateValid(packet.latitude, packet.longitude);
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
  nodes[idx].riskReasonBits = packet.riskReasonBits;
  nodes[idx].airTemp = packet.airTemp;
  nodes[idx].humidity = packet.humidity;
  nodes[idx].particleUgM3 = packet.particleUgM3;
  nodes[idx].sensorHealth = packet.sensorHealth;
}

String calculateAreaStatus() {
  int activeNodes = 0;
  bool hasWarning = false;
  bool hasWatch = false;
  int faultOrOfflineCount = 0;

  for (int i = 0; i < MAX_NODES; i++) {
    if (!nodes[i].used) continue;
    activeNodes++;

    if (nodes[i].offline) {
      faultOrOfflineCount++;
      continue;
    }

    if (nodes[i].state == "WARNING") hasWarning = true;
    if (nodes[i].state == "WATCH") hasWatch = true;
    if (nodes[i].state == "SENSOR_FAULT") faultOrOfflineCount++;
  }

  if (hasWarning) return "WARNING";
  if (hasWatch) return "WATCH";
  if (activeNodes > 0 && faultOrOfflineCount == activeNodes) return "NO_HEALTHY_NODES";
  if (faultOrOfflineCount > 0) return "NORMAL_WITH_NODE_ISSUE";
  return "NORMAL";
}

uint32_t nodeOfflineTimeoutMs(const NodeStatus &node) {
  if (node.reportIntervalSec == 0) return OFFLINE_TIMEOUT_MS;
  uint64_t adaptive =
    ((uint64_t)node.reportIntervalSec * 1000ULL * OFFLINE_INTERVAL_NUMERATOR) /
    OFFLINE_INTERVAL_DENOMINATOR + OFFLINE_JITTER_GRACE_MS;
  if (adaptive < OFFLINE_TIMEOUT_MS) return OFFLINE_TIMEOUT_MS;
  if (adaptive > UINT32_MAX) return UINT32_MAX;
  return (uint32_t)adaptive;
}

void checkOfflineNodes() {
  unsigned long now = millis();
  for (int i = 0; i < MAX_NODES; i++) {
    if (!nodes[i].used) continue;
    if (now - nodes[i].lastSeenMs > nodeOfflineTimeoutMs(nodes[i])) nodes[i].offline = true;
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
  Serial.print("  Risk Reason Bits: "); Serial.println(n.riskReasonBits);
  Serial.print("  Report Interval: "); Serial.print(n.reportIntervalSec); Serial.println(" sec");
  Serial.print("  Last Seq: "); Serial.println(n.lastSeq);
  Serial.print("  Last Seen: "); Serial.print((millis() - n.lastSeenMs) / 1000); Serial.println(" sec ago");
  printLocationOrNA(n);
  printFloatOrNA("  Air Temp: ", n.airTemp);
  printFloatOrNA("  Humidity: ", n.humidity);
  Serial.print("  Particle Estimated ug/m3: "); Serial.println(n.particleUgM3);
  Serial.print("  Sensor Health: "); Serial.println(n.sensorHealth);
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
    Serial.print("RSSI: "); Serial.println(rssi);
    Serial.print("SNR: "); Serial.println(snr);
    Serial.println("=====================================");
    return;
  }

  Serial.print("State: "); Serial.println(packet.state);
  Serial.print("Risk Reason Bits: "); Serial.println(packet.riskReasonBits);
  Serial.print("Report Interval: "); Serial.print(packet.reportIntervalSec); Serial.println(" sec");
  printFloatOrNA("Air Temp: ", packet.airTemp);
  printFloatOrNA("Humidity: ", packet.humidity);
  Serial.print("Particle Estimated ug/m3: "); Serial.println(packet.particleUgM3);
  Serial.print("Sensor Health: "); Serial.println(packet.sensorHealth);
  Serial.print("RSSI: "); Serial.println(rssi);
  Serial.print("SNR: "); Serial.println(snr);
  Serial.println("=====================================");
}

bool handleCommandAckPacket(const String &payload) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  if (deserializeJson(doc, payload)) return false;
  if (String((const char *)(doc["t"] | "")) != "cmd_ack") return false;

  String nodeId = String((const char *)(doc["id"] | ""));
  String commandId = String((const char *)(doc["cid"] | ""));
  bool accepted = (doc["ok"] | 1) == 1;
  String reason = String((const char *)(doc["r"] | ""));
  if (!hasPendingCommandForNode(commandId, nodeId)) {
    Serial.print("Unknown command ACK ignored: ");
    Serial.println(commandId);
    LoRa.receive();
    return true;
  }

  if (acknowledgePendingCommand(commandId, nodeId, accepted, reason)) {
    clearAndRememberAcknowledgedCommand(commandId, nodeId);
    Serial.print(accepted ? "Node confirmed command: " : "Node rejected command: ");
    Serial.print(commandId);
    Serial.print(" <- ");
    Serial.print(nodeId);
    if (!accepted && reason.length() > 0) {
      Serial.print(" reason=");
      Serial.print(reason);
    }
    Serial.println();
  } else {
    Serial.print("Command ACK queue full: ");
    Serial.println(commandId);
  }

  LoRa.receive();
  return true;
}

bool sendSensorUplinkAck(const ParsedPacket &packet) {
#if SENSOR_UPLINK_ACK_ENABLED
  if (packet.packetType != "sensor") return false;

  StaticJsonDocument<192> doc;
  doc["t"] = "rx_ack";
  doc["id"] = packet.nodeId;
  doc["q"] = packet.seq;
  doc["sid"] = packet.sessionId;
  String payload;
  serializeJson(doc, payload);

  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  bool sent = LoRa.endPacket();
  LoRa.receive();
  if (sent) {
    Serial.print("Sensor uplink ACK: ");
    Serial.print(packet.nodeId);
    Serial.print(" seq=");
    Serial.println(packet.seq);
  }
  return sent;
#else
  (void)packet;
  return false;
#endif
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

  if (handleCommandAckPacket(payload)) return;

  ParsedPacket parsed;
  if (!parseJsonPacket(payload, parsed)) {
    LoRa.receive();
    return;
  }

  int idx = getOrCreateNodeIndex(parsed.nodeId);
  if (idx < 0) {
    LoRa.receive();
    return;
  }

  // The node opens a short receive window immediately after every uplink.
  // A sensor ACK is sent first; any queued command follows in the same window.
  sendSensorUplinkAck(parsed);
  sendPendingCommandForNode(parsed.nodeId);

  if (isDuplicatePacket(idx, parsed)) {
    Serial.print("Duplicate packet ignored from ");
    Serial.print(parsed.nodeId);
    Serial.print(" seq=");
    Serial.println(parsed.seq);
    LoRa.receive();
    return;
  }

  updateNodeStatus(idx, parsed, rssi, snr);
  printReceivedPacket(parsed, rssi, snr);

#if WIFI_HTTP_ENABLED
  if (!enqueuePacketForBackend(payload, rssi, snr)) {
    Serial.println("HTTP packet queue full; packet not forwarded");
  }
#endif
  LoRa.receive();
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);
  disableUnusedRadios();

  for (int i = 0; i < MAX_NODES; i++) {
    nodes[i].used = false;
    nodes[i].offline = false;
    nodes[i].hasLocation = false;
    nodes[i].gpsFix = false;
    nodes[i].latitude = 0.0;
    nodes[i].longitude = 0.0;
    nodes[i].gpsError = "";
    nodes[i].gpsSeenMs = 0;
  }
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

void loop() {
#if WIFI_HTTP_ENABLED
  serviceWifiProvisioning();
#endif
  unsigned long now = millis();
  if (!loraReady && now - lastLoRaInitAttemptMs >= LORA_INIT_RETRY_MS) initLoRa();
  if (loraReady) handleIncomingLoRa();
  if (now - lastSummaryPrintMs > SUMMARY_PRINT_INTERVAL_MS) {
    lastSummaryPrintMs = now;
    printAllNodeStatus();
  }
}
