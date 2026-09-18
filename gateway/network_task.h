#pragma once

/*
  งานเครือข่ายเบื้องหลัง
  FreeRTOS task นี้แยก HTTP ออกจากลูปรับ LoRa เพื่อไม่ให้การเชื่อมต่อ Backend บังการรับวิทยุ
*/

#if WIFI_HTTP_ENABLED
// pollBackendCommands: ดึงรายการคำสั่งที่รอจาก Backend แล้วปรับคิวใน Gateway
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

// enqueuePacketForBackend: คัดลอกแพ็กเก็ต LoRa เข้าคิว HTTP โดยไม่บล็อกการรับวิทยุ
bool enqueuePacketForBackend(const String &payload, int rssi, float snr) {
  if (!httpPacketQueue || payload.length() > MAX_JSON_SIZE) return false;
  HttpPacketJob job = {};
  strlcpy(job.payload, payload.c_str(), sizeof(job.payload));
  job.rssi = rssi;
  job.snr = snr;
  return xQueueSend(httpPacketQueue, &job, 0) == pdTRUE;
}

// processCommandReport: ส่งสถานะคำสั่งไป Backend และลองใหม่เมื่อส่งไม่สำเร็จ
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

// networkTask: ทำงานเครือข่ายบนอีกคอร์หนึ่ง ทั้งส่งแพ็กเก็ต รายงานคำสั่ง และตรวจคำสั่งใหม่
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

// startNetworkTask: สร้างคิว mutex และ FreeRTOS task สำหรับงานเครือข่าย
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
