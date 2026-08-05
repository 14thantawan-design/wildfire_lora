#include "wifi_provisioning.h"

#include <Arduino.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

#include "config.h"

namespace {

const char *PREFERENCES_NAMESPACE = "gw_wifi";
const char *PREFERENCES_SSID_KEY = "ssid";
const char *PREFERENCES_PASSWORD_KEY = "password";
const char *PREFERENCES_CONFIGURED_KEY = "configured";

DNSServer dnsServer;
WebServer webServer(80);

String configuredSsid;
String configuredPassword;
String setupAccessPointName;

bool routesRegistered = false;
bool portalActive = false;
bool portalStopWhenConnected = false;
bool connectionAttemptActive = false;
bool connectedMessagePrinted = false;
bool buttonActionHandled = false;

unsigned long portalStartedMs = 0;
unsigned long portalStopMs = 0;
unsigned long buttonPressedMs = 0;
unsigned long connectionAttemptStartedMs = 0;
unsigned long nextConnectionAttemptMs = 0;
unsigned long disconnectedSinceMs = 0;
unsigned long reconnectDelayMs = WIFI_RECONNECT_INITIAL_DELAY_MS;

bool deadlineReached(unsigned long now, unsigned long deadline) {
  return static_cast<long>(now - deadline) >= 0;
}

bool hasConfiguredCredentials() {
  return configuredSsid.length() > 0;
}

String htmlEscape(String value) {
  value.replace("&", "&amp;");
  value.replace("<", "&lt;");
  value.replace(">", "&gt;");
  value.replace("\"", "&quot;");
  value.replace("'", "&#39;");
  return value;
}

void loadSavedCredentials() {
  bool preferencesWereConfigured = false;
  Preferences preferences;
  if (preferences.begin(PREFERENCES_NAMESPACE, true)) {
    preferencesWereConfigured = preferences.getBool(PREFERENCES_CONFIGURED_KEY, false);
    configuredSsid = preferences.getString(PREFERENCES_SSID_KEY, "");
    configuredPassword = preferences.getString(PREFERENCES_PASSWORD_KEY, "");
    preferences.end();
  }

  // The marker also represents an intentional "forget" action, so an empty
  // credential set remains an explicit first-time-setup state after reboot.
  if (preferencesWereConfigured) return;
}

bool saveCredentials(const String &ssid, const String &password) {
  Preferences preferences;
  if (!preferences.begin(PREFERENCES_NAMESPACE, false)) return false;

  size_t savedSsidLength = preferences.putString(PREFERENCES_SSID_KEY, ssid);
  size_t savedPasswordLength = preferences.putString(PREFERENCES_PASSWORD_KEY, password);
  size_t savedConfiguredLength = preferences.putBool(PREFERENCES_CONFIGURED_KEY, true);
  preferences.end();

  // putString returns the number of bytes written. An empty password is valid
  // for an open network, so only require the SSID write to succeed.
  (void)savedPasswordLength;
  return savedSsidLength == ssid.length() && savedConfiguredLength == sizeof(bool);
}

void clearCredentials() {
  Preferences preferences;
  if (preferences.begin(PREFERENCES_NAMESPACE, false)) {
    preferences.clear();
    preferences.putBool(PREFERENCES_CONFIGURED_KEY, true);
    preferences.end();
  }

  configuredSsid = "";
  configuredPassword = "";
}

String buildSetupAccessPointName() {
  uint64_t chipId = ESP.getEfuseMac();
  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%06X", static_cast<uint32_t>(chipId & 0xFFFFFF));
  return String(WIFI_SETUP_AP_PREFIX) + "-" + suffix;
}

String networkOptionsHtml() {
  int16_t networkCount = WiFi.scanComplete();
  if (networkCount == WIFI_SCAN_RUNNING) {
    return "<option value=\"\">กำลังค้นหาเครือข่าย...</option>";
  }

  if (networkCount < 0) {
    return "<option value=\"\">กรอกชื่อ Wi-Fi ได้เอง</option>";
  }

  String options;
  options.reserve(static_cast<size_t>(networkCount) * 80 + 80);
  for (int16_t i = 0; i < networkCount; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;

    bool duplicate = false;
    for (int16_t previous = 0; previous < i; previous++) {
      if (WiFi.SSID(previous) == ssid) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;

    options += "<option value=\"";
    options += htmlEscape(ssid);
    options += "\">";
    options += htmlEscape(ssid);
    options += " (";
    options += String(WiFi.RSSI(i));
    options += " dBm)</option>";
  }

  if (options.length() == 0) {
    options = "<option value=\"\">กรอกชื่อ Wi-Fi ได้เอง</option>";
  }
  return options;
}

String pageShell(const String &content, bool includeStatusScript) {
  String page;
  page.reserve(content.length() + 3000);
  page += F(
    "<!doctype html><html lang=\"th\"><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>Wildfire Gateway Setup</title><style>"
    "*{box-sizing:border-box}body{margin:0;background:#eef2ed;color:#17231b;"
    "font:16px system-ui,-apple-system,sans-serif}.card{width:min(92%,520px);margin:7vh auto;"
    "background:#fff;border-radius:20px;padding:26px;box-shadow:0 14px 40px #17351d22}"
    "h1{font-size:1.45rem;margin:0 0 8px;color:#1d5b31}p{line-height:1.55}"
    "label{display:block;font-weight:650;margin:18px 0 7px}input,select,button{width:100%;"
    "font:inherit;border-radius:11px;padding:12px}input,select{border:1px solid #b9c7bd;background:#fff}"
    "button{border:0;background:#26743d;color:#fff;font-weight:700;margin-top:20px;cursor:pointer}"
    ".muted{color:#607067;font-size:.9rem}.status{padding:11px 13px;background:#edf7ef;"
    "border-radius:10px}.danger{background:#fff4f1;color:#9c2f1e}.secondary{background:#64736a}"
    "</style></head><body><main class=\"card\">"
  );
  page += content;
  if (includeStatusScript) {
    page += F(
      "<script>setInterval(async()=>{try{const r=await fetch('/status',{cache:'no-store'});"
      "const s=await r.json();const e=document.getElementById('connection');if(!e)return;"
      "if(s.connected){e.textContent='เชื่อมต่อ '+s.ssid+' สำเร็จแล้ว';e.className='status';}"
      "else{e.textContent='กำลังลองเชื่อมต่อ Wi-Fi...';}}catch(_){ }},1500);</script>"
    );
  }
  page += F("</main></body></html>");
  return page;
}

void sendPortalPage() {
  String content;
  content.reserve(2600);
  content += F("<h1>ตั้งค่า Wildfire Gateway</h1>");
  content += F("<p class=\"muted\">เลือก Wi-Fi ที่มีอินเทอร์เน็ต แล้ว Gateway จะจำค่าและเชื่อมต่อเองทุกครั้งที่เปิดเครื่อง</p>");
  content += F("<div id=\"connection\" class=\"status\">");
  if (WiFi.status() == WL_CONNECTED) {
    content += "เชื่อมต่อ " + htmlEscape(WiFi.SSID()) + " อยู่";
  } else {
    content += F("ยังไม่ได้เชื่อมต่อ Wi-Fi");
  }
  content += F("</div><form method=\"post\" action=\"/save\">");
  content += F("<label for=\"ssid\">ชื่อ Wi-Fi</label><input id=\"ssid\" name=\"ssid\" list=\"networks\" maxlength=\"32\" required autocomplete=\"off\">");
  content += F("<datalist id=\"networks\">");
  content += networkOptionsHtml();
  content += F("</datalist><label for=\"password\">รหัสผ่าน Wi-Fi</label>");
  content += F("<input id=\"password\" name=\"password\" type=\"password\" maxlength=\"64\" autocomplete=\"new-password\">");
  content += F("<p class=\"muted\">เครือข่ายที่ไม่มีรหัสผ่านให้เว้นช่องนี้ว่าง</p>");
  content += F("<button type=\"submit\">บันทึกและเชื่อมต่อ</button></form>");
  if (hasConfiguredCredentials()) {
    content += F("<form method=\"post\" action=\"/forget\"><button class=\"secondary\" type=\"submit\">ล้างค่า Wi-Fi ที่บันทึกไว้</button></form>");
  }

  webServer.sendHeader("Cache-Control", "no-store");
  webServer.send(200, "text/html; charset=utf-8", pageShell(content, true));
}

void sendStatus() {
  String json = "{\"connected\":";
  json += WiFi.status() == WL_CONNECTED ? "true" : "false";
  json += ",\"ssid\":\"";
  String ssid = WiFi.status() == WL_CONNECTED ? WiFi.SSID() : configuredSsid;
  ssid.replace("\\", "\\\\");
  ssid.replace("\"", "\\\"");
  json += ssid;
  json += "\"}";
  webServer.sendHeader("Cache-Control", "no-store");
  webServer.send(200, "application/json", json);
}

void scheduleImmediateConnectionAttempt() {
  WiFi.disconnect(false, false);
  connectionAttemptActive = false;
  connectedMessagePrinted = false;
  reconnectDelayMs = WIFI_RECONNECT_INITIAL_DELAY_MS;
  nextConnectionAttemptMs = millis() + 250UL;
  disconnectedSinceMs = millis();
}

void handleSaveCredentials() {
  String ssid = webServer.arg("ssid");
  String password = webServer.arg("password");

  if (ssid.length() == 0 || ssid.length() > 32) {
    webServer.send(400, "text/html; charset=utf-8", pageShell(
      "<h1>ข้อมูลไม่ถูกต้อง</h1><p class=\"status danger\">ชื่อ Wi-Fi ต้องมีความยาว 1–32 ตัวอักษร</p><p><a href=\"/\">กลับไปตั้งค่า</a></p>",
      false
    ));
    return;
  }
  if (password.length() > 0 && (password.length() < 8 || password.length() > 64)) {
    webServer.send(400, "text/html; charset=utf-8", pageShell(
      "<h1>ข้อมูลไม่ถูกต้อง</h1><p class=\"status danger\">รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร หรือเว้นว่างสำหรับ Wi-Fi ที่ไม่มีรหัสผ่าน</p><p><a href=\"/\">กลับไปตั้งค่า</a></p>",
      false
    ));
    return;
  }

  if (!saveCredentials(ssid, password)) {
    webServer.send(500, "text/html; charset=utf-8", pageShell(
      "<h1>บันทึกไม่สำเร็จ</h1><p class=\"status danger\">ไม่สามารถเขียนค่าลงหน่วยความจำได้ กรุณาลองใหม่</p><p><a href=\"/\">กลับไปตั้งค่า</a></p>",
      false
    ));
    return;
  }

  configuredSsid = ssid;
  configuredPassword = password;
  portalStopWhenConnected = true;
  portalStopMs = 0;
  portalStartedMs = millis();
  scheduleImmediateConnectionAttempt();

  String content = "<h1>บันทึกค่าแล้ว</h1><p id=\"connection\" class=\"status\">กำลังลองเชื่อมต่อ ";
  content += htmlEscape(ssid);
  content += "...</p><p class=\"muted\">หากรหัสผ่านไม่ถูกต้อง ให้กลับไปหน้าตั้งค่าและกรอกใหม่</p><p><a href=\"/\">กลับไปหน้าตั้งค่า</a></p>";
  webServer.send(200, "text/html; charset=utf-8", pageShell(content, true));
}

void handleForgetCredentials() {
  clearCredentials();
  WiFi.disconnect(false, true);
  connectionAttemptActive = false;
  connectedMessagePrinted = false;
  disconnectedSinceMs = millis();
  portalStopWhenConnected = false;
  portalStopMs = 0;

  webServer.send(200, "text/html; charset=utf-8", pageShell(
    "<h1>ล้างค่า Wi-Fi แล้ว</h1><p class=\"status\">สามารถเลือกเครือข่ายใหม่ได้ทันที</p><p><a href=\"/\">ไปหน้าตั้งค่า</a></p>",
    false
  ));
}

void registerPortalRoutes() {
  if (routesRegistered) return;

  webServer.on("/", HTTP_GET, sendPortalPage);
  webServer.on("/save", HTTP_POST, handleSaveCredentials);
  webServer.on("/forget", HTTP_POST, handleForgetCredentials);
  webServer.on("/status", HTTP_GET, sendStatus);
  webServer.on("/generate_204", HTTP_ANY, sendPortalPage);
  webServer.on("/hotspot-detect.html", HTTP_ANY, sendPortalPage);
  webServer.on("/fwlink", HTTP_ANY, sendPortalPage);
  webServer.onNotFound(sendPortalPage);
  routesRegistered = true;
}

void startPortal(const char *reason) {
  if (portalActive) return;

  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP(setupAccessPointName.c_str(), WIFI_SETUP_AP_PASSWORD)) {
    Serial.println("Wi-Fi setup portal AP start FAILED");
    return;
  }

  registerPortalRoutes();
  dnsServer.start(53, "*", WiFi.softAPIP());
  webServer.begin();
  portalActive = true;
  portalStartedMs = millis();
  portalStopMs = 0;

  WiFi.scanDelete();
  WiFi.scanNetworks(true, true);

  Serial.print("Wi-Fi setup portal started (");
  Serial.print(reason);
  Serial.println(")");
  Serial.print("  Network: ");
  Serial.println(setupAccessPointName);
  Serial.print("  Password: ");
  Serial.println(WIFI_SETUP_AP_PASSWORD);
  Serial.print("  Open: http://");
  Serial.println(WiFi.softAPIP());
}

void stopPortal() {
  if (!portalActive) return;

  webServer.stop();
  dnsServer.stop();
  WiFi.scanDelete();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  portalActive = false;
  portalStopWhenConnected = false;
  portalStopMs = 0;
  Serial.println("Wi-Fi setup portal stopped");
}

void startConnectionAttempt() {
  if (!hasConfiguredCredentials()) return;

  Serial.print("Connecting Wi-Fi: ");
  Serial.println(configuredSsid);
  WiFi.mode(portalActive ? WIFI_AP_STA : WIFI_STA);
  WiFi.begin(configuredSsid.c_str(), configuredPassword.c_str());
  connectionAttemptActive = true;
  connectionAttemptStartedMs = millis();
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
    connectionAttemptActive = false;
    disconnectedSinceMs = 0;
    reconnectDelayMs = WIFI_RECONNECT_INITIAL_DELAY_MS;

    if (!connectedMessagePrinted) {
      connectedMessagePrinted = true;
      Serial.print("Wi-Fi connected: ");
      Serial.print(WiFi.SSID());
      Serial.print(" / ");
      Serial.println(WiFi.localIP());
    }

    if (portalActive && portalStopWhenConnected && portalStopMs == 0) {
      portalStopMs = now + WIFI_PORTAL_SUCCESS_CLOSE_DELAY_MS;
    }
    return;
  }

  connectedMessagePrinted = false;
  if (disconnectedSinceMs == 0) disconnectedSinceMs = now;

  if (!hasConfiguredCredentials()) {
    if (!portalActive) startPortal("no saved Wi-Fi");
    return;
  }

  if (!portalActive && now - disconnectedSinceMs >= WIFI_PORTAL_AUTO_START_MS) {
    startPortal("Wi-Fi unavailable");
  }

  if (connectionAttemptActive) {
    if (now - connectionAttemptStartedMs < WIFI_CONNECT_TIMEOUT_MS) return;

    connectionAttemptActive = false;
    WiFi.disconnect(false, false);
    nextConnectionAttemptMs = now + reconnectDelayMs;
    reconnectDelayMs = min(reconnectDelayMs * 2UL, static_cast<unsigned long>(WIFI_RECONNECT_MAX_DELAY_MS));
    Serial.println("Wi-Fi connect failed; retry scheduled");
    return;
  }

  if (deadlineReached(now, nextConnectionAttemptMs)) startConnectionAttempt();
}

}  // namespace

void beginWifiProvisioning() {
  pinMode(WIFI_CONFIG_BUTTON_PIN, INPUT_PULLUP);
  setupAccessPointName = buildSetupAccessPointName();

  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.mode(WIFI_STA);

  loadSavedCredentials();
  disconnectedSinceMs = millis();
  nextConnectionAttemptMs = millis();

  if (!hasConfiguredCredentials()) {
    startPortal("first-time setup");
  } else {
    startConnectionAttempt();
  }
}

void serviceWifiProvisioning() {
  unsigned long now = millis();
  serviceSetupButton(now);

  if (portalActive) {
    dnsServer.processNextRequest();
    webServer.handleClient();

    if (portalStopMs != 0 && deadlineReached(now, portalStopMs)) {
      stopPortal();
    } else if (hasConfiguredCredentials() &&
               now - portalStartedMs >= WIFI_PORTAL_TIMEOUT_MS) {
      stopPortal();
    }
  }

  serviceConnection(now);
}
