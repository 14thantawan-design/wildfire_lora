#include <Arduino.h>

// Standalone bench diagnostic for the installed NEO-6M wiring.
// It intentionally does not use Wi-Fi, LoRa, NVS, or deep sleep.
constexpr int GPS_RX_PIN = 34;     // GPS TX -> ESP32 GPIO34
constexpr int GPS_TX_PIN = -1;     // One-way GPS connection
constexpr int GPS_POWER_PIN = 13;  // GPIO13 -> load-switch/MOSFET SIG+
constexpr uint32_t GPS_BAUD = 9600;
constexpr uint32_t USB_BAUD = 115200;
constexpr uint32_t REPORT_INTERVAL_MS = 1000;

HardwareSerial gpsPort(2);

uint32_t totalBytes = 0;
uint32_t completedLines = 0;
uint32_t nmeaLines = 0;
uint32_t lastByteMs = 0;
uint32_t lastReportMs = 0;
String currentLine;
volatile uint32_t rxEdgeCount = 0;

void IRAM_ATTR countGpsRxEdge() {
  rxEdgeCount++;
}

bool looksLikeNmea(const String &line) {
  return line.startsWith("$GP") || line.startsWith("$GN") ||
         line.startsWith("$GL") || line.startsWith("$GA") ||
         line.startsWith("$GB") || line.startsWith("$BD");
}

void setup() {
  Serial.begin(USB_BAUD);
  delay(1200);

  pinMode(GPS_POWER_PIN, OUTPUT);
  digitalWrite(GPS_POWER_PIN, HIGH);
  delay(1500);

  pinMode(GPS_RX_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(GPS_RX_PIN), countGpsRxEdge, CHANGE);
  gpsPort.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  currentLine.reserve(160);

  Serial.println();
  Serial.println("=== GPS TX DIAGNOSTIC ===");
  Serial.println("Power command: GPIO13 = HIGH");
  Serial.println("Listening: GPS TX -> GPIO34 at 9600 baud");
  Serial.println("Interpretation:");
  Serial.println("  bytes > 0 and nmea > 0 : GPS power and TX path work");
  Serial.println("  bytes = 0            : check GPS power, TX wire, and common GND");
  Serial.println("  nmea > 0, no fix     : UART works; indoor satellite reception may be poor");
}

void loop() {
  while (gpsPort.available() > 0) {
    const char value = static_cast<char>(gpsPort.read());
    totalBytes++;
    lastByteMs = millis();

    if (value == '\n') {
      currentLine.trim();
      completedLines++;
      if (looksLikeNmea(currentLine)) nmeaLines++;
      currentLine = "";
    } else if (value != '\r' && currentLine.length() < 159) {
      currentLine += value;
    }
  }

  if (millis() - lastReportMs >= REPORT_INTERVAL_MS) {
    lastReportMs = millis();
    Serial.print("GPS_DIAG power_gpio=");
    Serial.print(digitalRead(GPS_POWER_PIN) == HIGH ? "HIGH" : "LOW");
    Serial.print(" bytes=");
    Serial.print(totalBytes);
    Serial.print(" lines=");
    Serial.print(completedLines);
    Serial.print(" nmea=");
    Serial.print(nmeaLines);
    Serial.print(" rx_level=");
    Serial.print(digitalRead(GPS_RX_PIN) == HIGH ? "HIGH" : "LOW");
    Serial.print(" edges=");
    Serial.print(rxEdgeCount);
    Serial.print(" last_byte_ms_ago=");
    Serial.println(lastByteMs == 0 ? -1 : static_cast<int32_t>(millis() - lastByteMs));
  }

  delay(2);
}
