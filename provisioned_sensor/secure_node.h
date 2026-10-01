#pragma once

struct FgNodeIdentity {
  uint32_t magic;
  uint8_t slot;
  uint8_t generation[8];
  uint8_t key[32];
  uint64_t reservedSequence;
};

FgNodeIdentity secureIdentity = {};
String secureNodeId;
uint64_t secureCurrentSequence = 0;
RTC_DATA_ATTR uint32_t fgRtcMagic = 0;
RTC_DATA_ATTR uint8_t fgRtcGeneration[8] = {};
RTC_DATA_ATTR uint64_t fgRtcNext = 0;
RTC_DATA_ATTR uint64_t fgRtcLimit = 0;
constexpr uint32_t FG_IDENTITY_MAGIC = 0x46473101;

bool storeSecureIdentity(const FgNodeIdentity &identity) {
  Preferences prefs;
  if (!prefs.begin("fg_identity", false)) return false;
  bool saved = prefs.putBytes("identity", &identity, sizeof(identity)) == sizeof(identity);
  prefs.end();
  return saved;
}

bool loadSecureIdentity() {
  Preferences prefs;
  if (!prefs.begin("fg_identity", true)) return false;
  bool valid = prefs.getBytesLength("identity") == sizeof(secureIdentity) &&
    prefs.getBytes("identity", &secureIdentity, sizeof(secureIdentity)) == sizeof(secureIdentity);
  prefs.end();
  valid = valid && secureIdentity.magic == FG_IDENTITY_MAGIC &&
    secureIdentity.slot >= 1 && secureIdentity.slot <= 10 &&
    secureIdentity.reservedSequence <= FG_MAX_SEQUENCE;
  if (valid) secureNodeId = fgNodeId(secureIdentity.slot);
  return valid;
}

// USB-only setup. A provisioned node offers a 10s setup window after reset;
// FG_SETUP keeps it awake. An unconfigured node never starts radio measurements.
void setupSecureNode() {
  bool configured = loadSecureIdentity();
  if (configured && esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER) return;
  bool setupMode = !configured;
  String line;
  unsigned long started = millis();
  unsigned long lastReady = 0;
  while (setupMode || millis() - started < 10000) {
    if (setupMode && millis() - lastReady > 1000) {
      Serial.println("FG1_READY");
      lastReady = millis();
    }
    while (Serial.available()) {
      char c = (char)Serial.read();
      if (c == '\r') continue;
      if (c != '\n') {
        if (line.length() < 512) line += c;
        else { line = ""; while (Serial.available()) Serial.read(); }
        continue;
      }
      if (line == "FG_SETUP") {
        setupMode = true;
        Serial.println("FG1_READY");
      } else if (setupMode) {
        StaticJsonDocument<768> doc;
        if (!deserializeJson(doc, line)) {
          String op = String((const char *)(doc["op"] | ""));
          if (op == "fg_start" && configured) return;
          if (op == "fg_provision") {
            FgNodeIdentity identity = {};
            String nodeId = String((const char *)(doc["node_id"] | ""));
            String generation = String((const char *)(doc["generation"] | ""));
            String challenge = String((const char *)(doc["challenge"] | ""));
            uint8_t challengeBytes[16];
            int slot = nodeId.startsWith("NODE") ? nodeId.substring(4).toInt() : 0;
            bool valid = slot >= 1 && slot <= 10 && nodeId == fgNodeId(slot) &&
              String((const char *)(doc["protocol"] | "")) == "FG1" &&
              fgParseHex(generation, identity.generation, 8) &&
              fgParseHex(String((const char *)(doc["key"] | "")), identity.key, 32) &&
              fgParseHex(challenge, challengeBytes, 16);
            if (valid) {
              identity.magic = FG_IDENTITY_MAGIC;
              identity.slot = slot;
              // Never reset a counter under the same key/generation during USB retries.
              if (configured && !memcmp(identity.generation, secureIdentity.generation, 8) &&
                  !memcmp(identity.key, secureIdentity.key, 32)) {
                identity.reservedSequence = secureIdentity.reservedSequence;
              }
              bool changed = !configured || memcmp(identity.generation, secureIdentity.generation, 8);
              if (storeSecureIdentity(identity)) {
                secureIdentity = identity;
                secureNodeId = nodeId;
                configured = true;
                if (changed) {
                  fgRtcMagic = 0;
                  const char *oldNamespaces[] = {"node_gps", "node_cmd"};
                  for (const char *name : oldNamespaces) {
                    Preferences old;
                    if (old.begin(name, false)) { old.clear(); old.end(); }
                  }
                }
                StaticJsonDocument<256> result;
                result["op"] = "fg_provisioned";
                result["node_id"] = nodeId;
                result["generation"] = generation;
                result["proof"] = fgProvisionProof(identity.key, nodeId, generation, challenge);
                serializeJson(result, Serial);
                Serial.println();
              } else Serial.println("FG1_STORAGE_ERROR");
            } else Serial.println("FG1_INVALID_CONFIG");
          }
        }
      }
      line = "";
    }
    delay(5);
  }
}

bool nextSecureSequence(uint64_t &sequence) {
  bool matchingRtc = fgRtcMagic == FG_IDENTITY_MAGIC &&
    !memcmp(fgRtcGeneration, secureIdentity.generation, 8) &&
    fgRtcNext > 0 && fgRtcNext <= fgRtcLimit && fgRtcLimit <= secureIdentity.reservedSequence;
  if (!matchingRtc) {
    if (secureIdentity.reservedSequence > FG_MAX_SEQUENCE - 256) return false;
    uint64_t start = secureIdentity.reservedSequence + 1;
    FgNodeIdentity updated = secureIdentity;
    updated.reservedSequence += 256;
    // Reserve durable counter block BEFORE emitting any ciphertext, including on cold reset.
    if (!storeSecureIdentity(updated)) return false;
    secureIdentity = updated;
    memcpy(fgRtcGeneration, secureIdentity.generation, 8);
    fgRtcNext = start;
    fgRtcLimit = updated.reservedSequence;
    fgRtcMagic = FG_IDENTITY_MAGIC;
  }
  sequence = fgRtcNext++;
  return true;
}

bool transmitSecurePayload(const String &payload) {
  uint64_t sequence;
  if (!nextSecureSequence(sequence)) { Serial.println("TX blocked: counter storage failed"); return false; }
  FgFrameInfo info = {};
  info.slot = secureIdentity.slot;
  memcpy(info.generation, secureIdentity.generation, 8);
  info.sequence = sequence;
  uint8_t frame[FG_MAX_FRAME];
  size_t length = fgEncrypt(payload, secureIdentity.key, info, "FGU1", frame);
  if (!length) { Serial.println("TX blocked: packet too large or encryption failed"); return false; }
  secureCurrentSequence = sequence;
  LoRa.idle();
  LoRa.beginPacket();
  LoRa.write(frame, length);
  return LoRa.endPacket();
}

bool receiveSecureReply(String &payload) {
  uint8_t frame[FG_MAX_FRAME];
  size_t length = 0;
  while (LoRa.available()) {
    int value = LoRa.read();
    if (length >= sizeof(frame)) { while (LoRa.available()) LoRa.read(); return false; }
    frame[length++] = value;
  }
  FgFrameInfo info;
  return fgDecrypt(frame, length, secureIdentity.key, "FGD1", info, payload) &&
    info.slot == secureIdentity.slot && info.sequence == secureCurrentSequence &&
    !memcmp(info.generation, secureIdentity.generation, 8);
}
