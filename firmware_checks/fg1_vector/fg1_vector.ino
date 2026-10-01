// Optional ESP32 hardware self-check: uses dummy keys only, no sensors or radio.
#include <Arduino.h>
#include <mbedtls/base64.h>
#include "../../radio_common/secure_frame.h"

void setup() {
  Serial.begin(115200);
  delay(1000);
  const char *reference = "RkdVMQEBAgMEBQYHCAAAAAAAAAABJDAr4zmL8EXLXhFBdM+NQh5n7H83ysJbKuckZFWdiFtL6ilarl3lGfpynmNTg6eP5mQv2zvy9m5FhDv/mRl65uiWS50zhvgltJGM1keYQ7g5FJ19Lw==";
  uint8_t expected[255];
  size_t expectedLength = 0;
  bool ok = mbedtls_base64_decode(expected, sizeof(expected), &expectedLength,
    (const unsigned char *)reference, strlen(reference)) == 0;
  uint8_t key[32] = {};
  FgFrameInfo info = {};
  info.slot = 1;
  for (int i = 0; i < 8; i++) info.generation[i] = i + 1;
  info.sequence = 1;
  const String plaintext = "{\"t\":\"s\",\"id\":\"NODE01\",\"ri\":300,\"st\":\"NORMAL\",\"at\":27,\"h\":70,\"adc\":0}";
  uint8_t frame[255];
  size_t length = fgEncrypt(plaintext, key, info, "FGU1", frame);
  ok = ok && length == expectedLength && !memcmp(frame, expected, length);
  String decoded;
  FgFrameInfo result;
  ok = ok && fgDecrypt(frame, length, key, "FGU1", result, decoded) && decoded == plaintext;
  for (size_t i = 0; i < length; i++) {
    frame[i] ^= 1;
    if (fgDecrypt(frame, length, key, "FGU1", result, decoded)) ok = false;
    frame[i] ^= 1;
  }
  Serial.println(ok ? "FG1_VECTOR_PASS" : "FG1_VECTOR_FAIL");
}
void loop() { delay(1000); }
