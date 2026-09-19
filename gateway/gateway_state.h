#pragma once

/*
  รูปแบบข้อมูลและสถานะส่วนกลางของ Gateway
  เก็บโครงสร้างแพ็กเก็ต คิวคำสั่ง และตัวแปรที่หลายโมดูลต้องใช้ร่วมกัน
*/

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
  float airTemp;
  float humidity;
  int particleAdc;
  String sensorHealth;
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

PendingCommand pendingCommands[MAX_PENDING_COMMANDS];
String acknowledgedCommandIds[MAX_PENDING_COMMANDS];
uint8_t nextAcknowledgedCommandIndex = 0;
unsigned long lastCommandPollMs = 0;
unsigned long lastLoRaInitAttemptMs = 0;
bool loraReady = false;

#if WIFI_HTTP_ENABLED
QueueHandle_t httpPacketQueue = nullptr;
QueueHandle_t commandReportQueue = nullptr;
SemaphoreHandle_t pendingCommandMutex = nullptr;
#endif

void clearPendingCommand(const String &commandId, const String &nodeId);
