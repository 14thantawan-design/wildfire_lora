#include <Arduino.h>
#include <Wire.h>

#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 22

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("I2C scanner starting...");
  Serial.print("SDA: ");
  Serial.println(I2C_SDA_PIN);
  Serial.print("SCL: ");
  Serial.println(I2C_SCL_PIN);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
}

void loop() {
  int found = 0;
  Serial.println("Scanning I2C...");

  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();
    if (error == 0) {
      Serial.print("Found 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
      found++;
    }
  }

  Serial.print("I2C device count: ");
  Serial.println(found);
  delay(2000);
}
