# โค้ดร่วมของ Sensor Node

โฟลเดอร์นี้เก็บขั้นตอนทำงานที่ NODE01 และ NODE02 ใช้เหมือนกัน เพื่อลดโค้ดซ้ำ
แต่ละโหนดยังคงมี `config.h` ของตัวเองสำหรับ `NODE_ID` และค่าฮาร์ดแวร์ที่อาจต่างกัน

## ลำดับอ่านสำหรับผู้เริ่มต้น

1. เปิด `sensor_node/sensor_node.ino` หรือ `sensor_node_2/sensor_node_2.ino`
2. ดู `config.h` ของโหนดนั้นเพื่อรู้ขาอุปกรณ์ เกณฑ์ และรอบเวลา
3. เริ่มอ่าน `setup()` และ `loop()` ที่ท้ายไฟล์ `.ino`
4. เปิด `node_app.h` เพื่อดู `setupNode()` และ `runOneMeasurementCycle()`
5. ตามไปยังไฟล์ที่ตรงกับงานที่ต้องการศึกษา

## หน้าที่ของแต่ละไฟล์

- `node_state.h` — รูปแบบข้อมูลและตัวแปรที่ใช้ร่วมกัน
- `sensor_config.h` — ขาอุปกรณ์ เกณฑ์ และรอบเวลาที่ใช้ร่วมกัน
- `node_helpers.h` — ฟังก์ชันช่วยทั่วไปและข้อความ Serial
- `sensor_reading.h` — อ่าน SHT31 และ Sharp GP2Y1014AU0F
- `risk_rules.h` — ตัดสิน NORMAL, WATCH, WARNING และ SENSOR_FAULT
- `lora_transport.h` — สร้าง JSON ส่ง LoRa และรอ ACK
- `gps_service.h` — ค้นหา บันทึก และรายงานพิกัด
- `gateway_commands.h` — รับคำสั่งและ ACK จาก Gateway
- `power_management.h` — ควบคุมรอบเวลาและ deep sleep
- `node_app.h` — ขั้นตอนเตรียมโหนดและลำดับรอบวัดที่ `.ino` เรียกใช้

ทุกฟังก์ชันมีคำอธิบายอยู่เหนือฟังก์ชันนั้นโดยตรง
