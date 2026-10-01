#pragma once
#include <Preferences.h>
#include <mbedtls/base64.h>
#include "../radio_common/secure_frame.h"

struct FgGatewayDevice {
  bool valid;
  uint8_t generation[8];
  uint8_t key[32];
  uint64_t lastSequence;
};
struct FgGatewayWatermark { uint8_t generation[8]; uint64_t sequence; };
FgGatewayDevice fgDevices[10] = {};
unsigned long fgRegistrySyncedAt = 0;
bool fgRegistryReady = false;

void lockFgDevices() {
#if WIFI_HTTP_ENABLED
  if (pendingCommandMutex) xSemaphoreTake(pendingCommandMutex, portMAX_DELAY);
#endif
}
void unlockFgDevices() {
#if WIFI_HTTP_ENABLED
  if (pendingCommandMutex) xSemaphoreGive(pendingCommandMutex);
#endif
}

#if WIFI_HTTP_ENABLED
// Private HTTPS endpoint: never print the response or retain keys across gateway reset.
bool syncFgDevices() {
  if (!ensureWiFiConnected()) return false;
  HTTPClient http;
  NetworkClientSecure secureClient;
  http.setTimeout(HTTP_POST_TIMEOUT_MS);
  if (!beginBackendHttp(http, secureClient, "https://wildfire.nattaphat.me/api/devices/gateway")) return false;
  http.addHeader("X-Gateway-Key", GATEWAY_API_KEY);
  int status = http.GET();
  String response = http.getString();
  http.end();
  if (status != 200 || response.length() > 4096) return false;
  DynamicJsonDocument doc(6144);
  if (deserializeJson(doc, response)) return false;
  JsonArray rows = doc["devices"].as<JsonArray>();
  if (rows.isNull() || rows.size() > 10) return false;
  FgGatewayDevice next[10] = {};
  for (JsonObject row : rows) {
    int slot = row["slot"] | 0;
    if (slot < 1 || slot > 10 || next[slot - 1].valid ||
        String((const char *)(row["node_id"] | "")) != fgNodeId(slot)) return false;
    FgGatewayDevice &device = next[slot - 1];
    if (!fgParseHex(String((const char *)(row["generation"] | "")), device.generation, 8) ||
        !fgParseHex(String((const char *)(row["key"] | "")), device.key, 32)) return false;
    device.lastSequence = row["last_sequence"].as<uint64_t>();
    if (device.lastSequence > FG_MAX_SEQUENCE) return false;
    device.valid = true;
  }
  lockFgDevices();
  Preferences prefs;
  if (!prefs.begin("fg_gateway", true)) {
    if (!prefs.begin("fg_gateway", false)) { unlockFgDevices(); return false; }
  }
  for (int i = 0; i < 10; i++) {
    if (!next[i].valid) continue;
    if (fgDevices[i].valid && !memcmp(next[i].generation, fgDevices[i].generation, 8)) {
      next[i].lastSequence = max(next[i].lastSequence, fgDevices[i].lastSequence);
    }
    FgGatewayWatermark saved = {};
    String name = String("slot") + (i + 1);
    if (prefs.getBytesLength(name.c_str()) == sizeof(saved) &&
        prefs.getBytes(name.c_str(), &saved, sizeof(saved)) == sizeof(saved) &&
        !memcmp(saved.generation, next[i].generation, 8)) {
      next[i].lastSequence = max(next[i].lastSequence, saved.sequence);
    }
  }
  prefs.end();
  memcpy(fgDevices, next, sizeof(next));
  fgRegistrySyncedAt = millis();
  fgRegistryReady = true;
  unlockFgDevices();
  return true;
}
#endif

bool acceptFgUplink(const uint8_t *frame, size_t length, FgFrameInfo &info,
                    FgGatewayDevice &device, String &payload) {
  if (!fgInspect(frame, length, "FGU1", info)) return false;
  lockFgDevices();
  device = fgDevices[info.slot - 1];
  bool permitted = fgRegistryReady && millis() - fgRegistrySyncedAt < 30000 && device.valid &&
    !memcmp(device.generation, info.generation, 8) && info.sequence > device.lastSequence;
  unlockFgDevices();
  if (!permitted || !fgDecrypt(frame, length, device.key, "FGU1", info, payload)) return false;
  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, payload) || String((const char *)(doc["id"] | "")) != fgNodeId(info.slot)) return false;
  String type = String((const char *)(doc["t"] | ""));
  if (type != "s" && type != "gps" && type != "cmd_ack") return false;
  lockFgDevices();
  FgGatewayDevice &current = fgDevices[info.slot - 1];
  permitted = fgRegistryReady && millis() - fgRegistrySyncedAt < 30000 && current.valid &&
    !memcmp(current.generation, info.generation, 8) && info.sequence > current.lastSequence;
  if (permitted) {
    Preferences prefs;
    permitted = prefs.begin("fg_gateway", false);
    if (permitted) {
      FgGatewayWatermark saved = {};
      memcpy(saved.generation, info.generation, 8);
      saved.sequence = info.sequence;
      String name = String("slot") + info.slot;
      permitted = prefs.putBytes(name.c_str(), &saved, sizeof(saved)) == sizeof(saved);
      prefs.end();
    }
    if (permitted) current.lastSequence = info.sequence;
  }
  unlockFgDevices();
  return permitted;
}

String fgBase64(const uint8_t *frame, size_t length) {
  unsigned char buffer[341] = {};
  size_t written = 0;
  if (mbedtls_base64_encode(buffer, sizeof(buffer), &written, frame, length)) return "";
  buffer[written] = 0;
  return String((char *)buffer);
}
