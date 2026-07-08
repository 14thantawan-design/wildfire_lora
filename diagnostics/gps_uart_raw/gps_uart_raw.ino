#include <Arduino.h>

#define GPS_RX_PIN 34
#define GPS_TX_PIN -1
#define GPS_BAUD 9600

uint32_t byteCount = 0;
uint32_t lineCount = 0;
unsigned long lastReportMs = 0;
char lineBuf[96];
size_t lineLen = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("GPS RAW UART TEST");
  Serial.println("No TinyGPSPlus, raw Serial2 only");

  Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("Serial2 started");
}

void loop() {
  while (Serial2.available() > 0) {
    char c = (char)Serial2.read();
    byteCount++;

    if (c == '\n') {
      lineBuf[lineLen] = '\0';
      if (lineLen > 0) {
        lineCount++;
        Serial.print("NMEA: ");
        Serial.println(lineBuf);
      }
      lineLen = 0;
    } else if (c != '\r') {
      if (lineLen < sizeof(lineBuf) - 1) {
        lineBuf[lineLen++] = c;
      } else {
        lineLen = 0;
      }
    }
  }

  if (millis() - lastReportMs >= 1000UL) {
    lastReportMs = millis();
    Serial.print("bytes=");
    Serial.print(byteCount);
    Serial.print(" lines=");
    Serial.println(lineCount);
  }
}
