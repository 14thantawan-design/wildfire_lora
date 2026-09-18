#pragma once

/*
  การเริ่มวิทยุ LoRa ของ Gateway
  ค่าคลื่นใน config.h ต้องตรงกับ Sensor Node ทุกตัว
*/

// initLoRa: ตั้งค่า SPI และวิทยุ LoRa ให้ตรงกับโหนด แล้วเข้าสู่โหมดรับ
bool initLoRa() {
  lastLoRaInitAttemptMs = millis();
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    loraReady = false;
    Serial.println("LoRa init FAILED");
    return false;
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_SIGNAL_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE_DENOMINATOR);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.setTxPower(LORA_TX_POWER_DBM);
  LoRa.enableCrc();
  LoRa.receive();

  Serial.print("LoRa gateway init OK SF=");
  Serial.print(LORA_SPREADING_FACTOR);
  Serial.print(" TX=");
  Serial.print(LORA_TX_POWER_DBM);
  Serial.println(" dBm");
  loraReady = true;
  return true;
}
