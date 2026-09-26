#pragma once

/*
  รูปแบบข้อมูลและสถานะส่วนกลางของ Gateway
  เก็บคิวคำสั่งและตัวแปรที่หลายโมดูลต้องใช้ร่วมกัน
*/

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
QueueHandle_t commandReportQueue = nullptr;
SemaphoreHandle_t pendingCommandMutex = nullptr;
#endif

void clearPendingCommand(const String &commandId, const String &nodeId);
