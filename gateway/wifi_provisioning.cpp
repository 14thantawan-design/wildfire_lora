#include "wifi_provisioning.h"

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>

#include "config.h"

namespace {

WiFiManager wifiManager;
String setupAccessPointName;

bool credentialsSaved = false;
bool connectedMessagePrinted = false;
bool buttonActionHandled = false;

unsigned long buttonPressedMs = 0;
unsigned long disconnectedSinceMs = 0;

String buildSetupAccessPointName() {
  uint64_t chipId = ESP.getEfuseMac();
  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%06X", static_cast<uint32_t>(chipId & 0xFFFFFF));
  return String(WIFI_SETUP_AP_PREFIX) + "-" + suffix;
}

void printPortalDetails(const char *reason) {
  Serial.print("Wi-Fi setup portal started (");
  Serial.print(reason);
  Serial.println(")");
  Serial.print("  Network: ");
  Serial.println(setupAccessPointName);
  Serial.println("  Password: none (open setup network)");
  Serial.println("  Open: http://192.168.4.1");
}

void startPortal(const char *reason) {
  if (wifiManager.getConfigPortalActive()) return;

  unsigned long timeoutSeconds = wifiManager.getWiFiIsSaved()
    ? WIFI_PORTAL_TIMEOUT_MS / 1000UL
    : 0;
  wifiManager.setConfigPortalTimeout(timeoutSeconds);
  wifiManager.startConfigPortal(setupAccessPointName.c_str());
  if (wifiManager.getConfigPortalActive()) printPortalDetails(reason);
}

void connectUsingSavedCredentials() {
  WiFi.mode(WIFI_STA);
  WiFi.begin();
  disconnectedSinceMs = millis();
  connectedMessagePrinted = false;
  Serial.println("Connecting to saved Wi-Fi...");
}

void serviceSetupButton(unsigned long now) {
  if (digitalRead(WIFI_CONFIG_BUTTON_PIN) == LOW) {
    if (buttonPressedMs == 0) buttonPressedMs = now;
    if (!buttonActionHandled && now - buttonPressedMs >= WIFI_CONFIG_BUTTON_HOLD_MS) {
      buttonActionHandled = true;
      startPortal("setup button held");
    }
    return;
  }

  buttonPressedMs = 0;
  buttonActionHandled = false;
}

void serviceConnection(unsigned long now) {
  if (WiFi.status() == WL_CONNECTED) {
    disconnectedSinceMs = 0;
    if (!connectedMessagePrinted) {
      connectedMessagePrinted = true;
      Serial.print("Wi-Fi connected: ");
      Serial.print(WiFi.SSID());
      Serial.print(" / ");
      Serial.println(WiFi.localIP());
    }
    return;
  }

  connectedMessagePrinted = false;
  if (disconnectedSinceMs == 0) disconnectedSinceMs = now;
  if (now - disconnectedSinceMs >= WIFI_PORTAL_AUTO_START_MS) {
    startPortal("Wi-Fi unavailable");
  }
}

}  // namespace

void beginWifiProvisioning() {
  pinMode(WIFI_CONFIG_BUTTON_PIN, INPUT_PULLUP);
  setupAccessPointName = buildSetupAccessPointName();

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.mode(WIFI_STA);

  wifiManager.setConfigPortalBlocking(false);
  wifiManager.setSaveConnect(false);
  wifiManager.setSaveConfigCallback([]() { credentialsSaved = true; });

  if (wifiManager.getWiFiIsSaved()) {
    connectUsingSavedCredentials();
  } else {
    disconnectedSinceMs = millis();
    startPortal("first-time setup");
  }
}

void serviceWifiProvisioning() {
  unsigned long now = millis();
  serviceSetupButton(now);

  bool portalWasActive = wifiManager.getConfigPortalActive();
  if (portalWasActive) wifiManager.process();

  if (portalWasActive &&
      !wifiManager.getConfigPortalActive() &&
      !credentialsSaved) {
    connectUsingSavedCredentials();
  }

  if (credentialsSaved) {
    credentialsSaved = false;
    wifiManager.stopConfigPortal();
    connectUsingSavedCredentials();
  }

  serviceConnection(now);
}
