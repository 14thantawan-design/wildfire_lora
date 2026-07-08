#include <Arduino.h>
#include <TinyGPSPlus.h>

#define GPS_RX_PIN 34
#define GPS_TX_PIN 17
#define GPS_BAUD 9600

TinyGPSPlus gps;

unsigned long lastReportMs = 0;
uint32_t byteCount = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("GPS UART TEST");
  Serial.println("Wiring: GPS TX -> GPIO34, GPS RX optional/unconnected");

  Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("Serial2 started");
}

void loop() {
  while (Serial2.available() > 0) {
    gps.encode((char)Serial2.read());
    byteCount++;
  }

  if (millis() - lastReportMs >= 1000UL) {
    lastReportMs = millis();

    Serial.print("bytes=");
    Serial.print(byteCount);
    Serial.print(" chars=");
    Serial.print(gps.charsProcessed());
    Serial.print(" sentences=");
    Serial.print(gps.passedChecksum());
    Serial.print(" failed=");
    Serial.print(gps.failedChecksum());
    Serial.print(" sat=");
    if (gps.satellites.isValid()) Serial.print(gps.satellites.value());
    else Serial.print("NA");
    Serial.print(" hdop=");
    if (gps.hdop.isValid()) Serial.print(gps.hdop.hdop());
    else Serial.print("NA");
    Serial.print(" loc=");
    if (gps.location.isValid()) {
      Serial.print(gps.location.lat(), 6);
      Serial.print(",");
      Serial.print(gps.location.lng(), 6);
    } else {
      Serial.print("NO_FIX");
    }
    Serial.println();
  }
}
