#pragma once

/*
  งาน GPS command เบื้องหลัง
  ดึงคำสั่งจาก Backend และส่งผล ACK กลับโดยไม่ปนกับทางเดินข้อมูลเซนเซอร์
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

// networkTask: รายงานผลคำสั่งและตรวจคำสั่งใหม่บนอีกคอร์หนึ่ง
void networkTask(void *parameter) {
  (void)parameter;

  for (;;) {
    CommandReportJob report;
    if (xQueueReceive(commandReportQueue, &report, 0) == pdTRUE) {
      processCommandReport(report);
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
  commandReportQueue = xQueueCreate(COMMAND_REPORT_QUEUE_LENGTH, sizeof(CommandReportJob));
  pendingCommandMutex = xSemaphoreCreateMutex();
  if (!commandReportQueue || !pendingCommandMutex) return false;

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
