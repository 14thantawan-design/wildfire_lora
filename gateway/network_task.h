#pragma once

/*
  งานเครือข่ายเบื้องหลัง
  ส่งแพ็กเก็ตเซนเซอร์และรายงานคำสั่ง โดยไม่บล็อกการรับ LoRa
*/

#if WIFI_HTTP_ENABLED
// pollBackendCommands: ดึงรายการคำสั่งที่รอจาก Backend แล้วปรับคิวใน Gateway
void pollBackendCommands() {
  if (!ensureWiFiConnected()) return;

  HTTPClient http;
  NetworkClientSecure secureClient;
  http.setTimeout(HTTP_POST_TIMEOUT_MS);
  if (!beginBackendHttp(http, secureClient, "https://wildfire.nattaphat.me/api/commands/pending")) return;

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
      String((const char *)(command["command"] | "")),
      String((const char *)(command["credential_generation"] | ""))
    );
  }
}

// enqueuePacketForBackend: พัก JSON ไว้ให้ networkTask ส่ง เพื่อให้ loop กลับไปรับ LoRa ต่อ
bool enqueuePacketForBackend(const String &payload) {
  if (!httpPacketQueue || payload.length() > MAX_JSON_SIZE) return false;
  HttpPacketJob job = {};
  strlcpy(job.payload, payload.c_str(), sizeof(job.payload));
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

// networkTask: ส่งแพ็กเก็ตจากคิวและดูแลงานคำสั่งบนอีกคอร์หนึ่ง
void networkTask(void *parameter) {
  (void)parameter;
  unsigned long lastDeviceSyncMs = 0;

  for (;;) {
    CommandReportJob report;
    if (xQueueReceive(commandReportQueue, &report, 0) == pdTRUE) {
      processCommandReport(report);
    }

    HttpPacketJob packet;
    if (xQueueReceive(httpPacketQueue, &packet, 0) == pdTRUE) {
      postPacketToBackend(String(packet.payload));
    }

    unsigned long now = millis();
    if (lastDeviceSyncMs == 0 || now - lastDeviceSyncMs >= 10000UL) {
      lastDeviceSyncMs = now;
      syncFgDevices();
    }
    if (now - lastCommandPollMs >= COMMAND_POLL_INTERVAL_MS) {
      lastCommandPollMs = now;
      pollBackendCommands();
    }

    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// startNetworkTask: สร้างคิว mutex และ FreeRTOS task สำหรับงานเครือข่าย
bool startNetworkTask() {
  httpPacketQueue = xQueueCreate(20, sizeof(HttpPacketJob));
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
