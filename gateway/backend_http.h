#pragma once

/*
  การเชื่อมต่อ Backend ผ่าน Wi-Fi/HTTP
  ดูแลเวลา HTTPS ส่งข้อมูลเซนเซอร์ และรายงานสถานะคำสั่ง
*/

#if WIFI_HTTP_ENABLED
// ensureWiFiConnected: ตรวจการเชื่อมต่อ Wi-Fi และรอช่วงสั้น ๆ ให้ระบบ provisioning เชื่อมต่อกลับ
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

// ensureBackendClock: ซิงก์เวลาจาก NTP เพื่อให้ตรวจใบรับรอง HTTPS ของ Backend ได้
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

// beginBackendHttp: เปิดการเชื่อมต่อ HTTP หรือ HTTPS และใส่ Root CA เมื่อ URL เป็น HTTPS
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

// postPacketToBackend: ส่งแพ็กเก็ตโหนดไป Backend พร้อมเพิ่มค่า RSSI และ SNR ลงใน JSON
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

// postCommandAck: แจ้ง Backend ว่าโหนดยอมรับหรือปฏิเสธคำสั่ง
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

// postCommandSent: แจ้ง Backend ว่า Gateway ส่งคำสั่งไปทาง LoRa แล้ว
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
