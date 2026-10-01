#pragma once

/*
  คิวและการส่งคำสั่งไปยัง Sensor Node
  เก็บคำสั่งที่ Backend รอ ส่งเมื่อโหนดตื่น และรายงานผลกลับ
*/

// lockPendingCommands: ล็อกคิวคำสั่งก่อนอ่านหรือแก้ไข เพื่อป้องกันสอง task เข้าพร้อมกัน
void lockPendingCommands() {
#if WIFI_HTTP_ENABLED
  if (pendingCommandMutex) xSemaphoreTake(pendingCommandMutex, portMAX_DELAY);
#endif
}

// unlockPendingCommands: ปลดล็อกคิวคำสั่งหลังทำงานเสร็จ
void unlockPendingCommands() {
#if WIFI_HTTP_ENABLED
  if (pendingCommandMutex) xSemaphoreGive(pendingCommandMutex);
#endif
}

// hasPendingCommandUnlocked: ตรวจว่ารหัสคำสั่งอยู่ในคิวหรือไม่ โดยผู้เรียกต้องล็อกคิวไว้ก่อน
bool hasPendingCommandUnlocked(const String &commandId) {
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (pendingCommands[i].used && pendingCommands[i].commandId == commandId) return true;
  }
  return false;
}

// wasCommandAcknowledgedUnlocked: ตรวจว่าคำสั่งเคยได้รับ ACK แล้วหรือไม่ โดยผู้เรียกต้องล็อกคิวไว้ก่อน
bool wasCommandAcknowledgedUnlocked(const String &commandId) {
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (acknowledgedCommandIds[i] == commandId) return true;
  }
  return false;
}

// queuePendingCommand: เพิ่มคำสั่งจาก Backend ลงคิว หากยังไม่เคยรับหรือทำสำเร็จ
bool queuePendingCommand(const String &commandId, const String &nodeId, const String &command,
                         const String &generation) {
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
      pendingCommands[i].generation = generation;
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

// serverStillHasCommand: ตรวจว่า Backend ยังส่งคำสั่งรหัสนี้มาในรายการล่าสุดหรือไม่
bool serverStillHasCommand(JsonArray serverCommands, const String &commandId) {
  for (JsonObject command : serverCommands) {
    if (String((const char *)(command["command_id"] | "")) == commandId) return true;
  }
  return false;
}

// reconcilePendingCommands: ลบคำสั่งใน RAM ที่ Backend ไม่มีอยู่แล้ว เพื่อให้สองฝั่งตรงกัน
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

// queueCommandReport: เพิ่มรายงานคำสั่งลงคิวเพื่อให้ networkTask ส่งไป Backend
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

// markPendingCommandSent: บันทึกรายงานว่าคำสั่งถูกส่งทาง LoRa แล้ว
bool markPendingCommandSent(const String &commandId, const String &nodeId) {
#if WIFI_HTTP_ENABLED
  return queueCommandReport(COMMAND_REPORT_SENT, commandId, nodeId);
#else
  Serial.print("CMD_SENT ");
  Serial.println(commandId);
  return true;
#endif
}

// acknowledgePendingCommand: เพิ่มรายงานผลยอมรับหรือปฏิเสธคำสั่งจากโหนด
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

// findPendingCommandIndexUnlocked: ค้นหาตำแหน่งคำสั่งจาก commandId และ nodeId โดยไม่ล็อกคิวเอง
int findPendingCommandIndexUnlocked(const String &commandId, const String &nodeId) {
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (pendingCommands[i].used &&
        pendingCommands[i].commandId == commandId &&
        pendingCommands[i].nodeId == nodeId) return i;
  }
  return -1;
}

// hasPendingCommandForNode: ตรวจว่าคำสั่งนี้กำลังรอโหนดเป้าหมายอยู่หรือไม่
bool hasPendingCommandForNode(const String &commandId, const String &nodeId) {
  lockPendingCommands();
  bool found = findPendingCommandIndexUnlocked(commandId, nodeId) >= 0;
  unlockPendingCommands();
  return found;
}

// clearPendingCommand: นำคำสั่งที่ระบุออกจากคิวรอ
void clearPendingCommand(const String &commandId, const String &nodeId) {
  lockPendingCommands();
  int index = findPendingCommandIndexUnlocked(commandId, nodeId);
  if (index >= 0) pendingCommands[index].used = false;
  unlockPendingCommands();
}

// clearAndRememberAcknowledgedCommand: ลบคำสั่งที่เสร็จและจำรหัสไว้เพื่อไม่รับซ้ำ
void clearAndRememberAcknowledgedCommand(const String &commandId, const String &nodeId) {
  lockPendingCommands();
  int index = findPendingCommandIndexUnlocked(commandId, nodeId);
  if (index >= 0) pendingCommands[index].used = false;
  acknowledgedCommandIds[nextAcknowledgedCommandIndex] = commandId;
  nextAcknowledgedCommandIndex =
    (nextAcknowledgedCommandIndex + 1) % MAX_PENDING_COMMANDS;
  unlockPendingCommands();
}

// One authenticated reply combines receive ACK and the queued GPS command.
bool sendSecureReplyForNode(const String &nodeId, const FgFrameInfo &info,
                            const FgGatewayDevice &device, bool sensorAck) {
  String commandId;
  String commandName;
  lockPendingCommands();
  for (int i = 0; i < MAX_PENDING_COMMANDS; i++) {
    if (!pendingCommands[i].used || pendingCommands[i].nodeId != nodeId ||
        pendingCommands[i].generation != fgHex(info.generation, 8)) continue;
    commandId = pendingCommands[i].commandId;
    commandName = pendingCommands[i].command;
    break;
  }
  unlockPendingCommands();
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  doc["t"] = "reply";
  doc["id"] = nodeId;
  doc["a"] = sensorAck ? 1 : 0;
  if (commandId.length() > 0) {
    doc["cmd"] = commandName;
    doc["cid"] = commandId;
  }
  String payload;
  serializeJson(doc, payload);
  uint8_t frame[FG_MAX_FRAME];
  size_t length = fgEncrypt(payload, device.key, info, "FGD1", frame);
  if (!length) return false;

  LoRa.idle();
  LoRa.beginPacket();
  LoRa.write(frame, length);
  bool sent = LoRa.endPacket();
  LoRa.receive();
  if (!sent) return false;
  if (commandId.length() == 0) return true;

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
