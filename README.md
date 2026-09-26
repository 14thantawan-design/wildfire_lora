# Wildfire LoRa — SHT31 + Sharp GP2Y1014AU0F

ระบบต้นแบบตรวจสัญญาณบ่งชี้ไฟป่าจากอุณหภูมิอากาศ ความชื้นสัมพัทธ์ และอนุภาคในอากาศ
โดย Sensor Node ตัดสินสถานะแล้วส่งผ่าน LoRa ไป Gateway, Backend และ Dashboard

ระบบใช้สถานะ `NORMAL`, `WATCH`, `WARNING` และ `SENSOR_FAULT` ตามเกณฑ์ที่กำหนดไว้ในโค้ด

## เกณฑ์สถานะ

โหนดตรวจเซนเซอร์ก่อน ถ้าอ่านผิดปกติจะเป็น `SENSOR_FAULT` มิฉะนั้นจึงตรวจ `WARNING`, `WATCH` และ `NORMAL`

| สถานะ | เงื่อนไข |
|---|---|
| `SENSOR_FAULT` | อุณหภูมิ/ความชื้นอ่านไม่ได้หรือหลุดช่วงเซนเซอร์ หรือ ADC หลุดช่วง 0–4095 |
| `WARNING` | อุณหภูมิ `> 45°C` **หรือ** ค่าควัน `ADC > 1100` **หรือ** อุณหภูมิ `>= 30°C` พร้อมความชื้น `<= 30%RH` |
| `WATCH` | ยังไม่เป็น `WARNING` และอุณหภูมิ `> 35°C` **หรือ** ค่าควัน `ADC > 300` **หรือ** ความชื้น `< 50%RH` |
| `NORMAL` | อุณหภูมิ `<= 35°C` และค่าควัน `ADC <= 300` และความชื้น `>= 50%RH` |

เงื่อนไขอุณหภูมิ `>= 30°C` ร่วมกับความชื้น `<= 30%RH` คือการใช้สองปัจจัยที่โครงการวัดได้
จากแนวคิด 30-30-30 โดยระบบไม่มีเซนเซอร์ความเร็วลม จึงไม่กล่าวอ้างว่าใช้กฎครบสามปัจจัย

รายละเอียดขอบเขตและตัวอย่างอยู่ใน
[`docs/node-risk-rules.md`](docs/node-risk-rules.md)

## รอบวัดและส่งข้อมูลภาคสนาม

| สถานะ | รอบวัดและส่ง | การทำงาน |
|---|---:|---|
| `NORMAL` | 5 นาที | Deep sleep ระหว่างรอบ |
| `WATCH` | 2 นาที | Deep sleep ระหว่างรอบ |
| `WARNING` | 20 วินาที | ทำงานต่อเนื่องโดยไม่ Deep sleep |
| `SENSOR_FAULT` | 5 นาที | Deep sleep ระหว่างรอบ |

คาบเป็นแบบเริ่มรอบถึงเริ่มรอบ โค้ดจึงหักเวลาอ่านเซนเซอร์ ส่ง LoRa และฟังคำสั่ง GPS ออกจากเวลาที่เหลือ
ถ้ารอบส่งใช้เวลานานกว่า 20 วินาที รอบถัดไปจะเริ่มทันทีเมื่อรอบเดิมจบ

โหนดแต่ละตัวหน่วงส่งแบบสุ่มไม่เกิน 5 วินาทีเพื่อลดโอกาสชนกัน อย่างไรก็ตามค่า LoRa ปัจจุบันคือ
SF12/BW125 kHz ซึ่งมี airtime สูง ควรทดสอบ NODE01 และ NODE02 ส่งทุก 20 วินาทีพร้อมกันในพื้นที่จริง
ก่อนสรุปความน่าเชื่อถือของระบบ

## การวัดควันด้วย Sharp

Sharp GP2Y1014AU0F อ่าน ADC ดิบ 3 ครั้งตามจังหวะใน datasheet แล้วใช้ค่ากลาง โดยไม่แปลงเป็น µg/m³

ค่า ADC เป็นค่าดิบของบอร์ดในช่วง 0–4095 ไม่ใช่ PM2.5 หรือความเข้มข้นที่สอบเทียบแล้ว
เกณฑ์ `300/1100` จึงเป็นเกณฑ์ทดลองของต้นแบบที่ต้องทดสอบกับฮาร์ดแวร์จริง

## แพ็กเก็ต Sensor

ตัวอย่างแพ็กเก็ต LoRa:

```json
{"t":"s","id":"NODE01","ri":20,"st":"WARNING","at":30,"h":30,"adc":1200}
```

- `st`: สถานะที่เฟิร์มแวร์ตัดสิน
- `ri`: รอบรายงานที่โหนดกำหนด หน่วยวินาที
- `at`, `h`, `adc`: อุณหภูมิ ความชื้น และค่าควัน ADC ดิบ
Backend บันทึกผลจากโหนดโดยไม่ตรวจค่าหรือคำนวณเกณฑ์ซ้ำ

## โครงสร้างสำคัญ

```text
sensor_node/          เฟิร์มแวร์ NODE01
sensor_node_2/        เฟิร์มแวร์ NODE02
sensor_common/        ฟังก์ชันร่วมของทั้งสองโหนด แยกตามหน้าที่เป็นไฟล์ .h
gateway/              เฟิร์มแวร์ Gateway แยกไฟล์รับ LoRa, HTTP และคำสั่งตามหน้าที่
wildfire-backend/     API, MongoDB, Alert และ Telegram
wildfire-dashboard/   หน้าเว็บสถานะ แผนที่ และกราฟ
tools/test_node_risk.mjs  ทดสอบฟังก์ชัน C++ จริงของทั้งสองโหนด
```

## ไลบรารี Arduino

- LoRa by Sandeep Mistry
- ArduinoJson
- WiFiManager 2.0.17 (ใช้เฉพาะ Gateway)
- Adafruit SHT31 Library
- Adafruit BusIO
- TinyGPSPlus

บอร์ดที่ใช้คอมไพล์คือ `esp32:esp32:ttgo-lora32` การตั้งขา SHT31, Sharp, GPS และ LoRa
อยู่ใน `config.h` ของแต่ละสเก็ตช์ ทั้ง Gateway และ Sensor Node ต้องใช้ความถี่, spreading factor,
bandwidth, coding rate และ sync word ตรงกัน

## วิธีอัปโหลด

1. ตั้ง `TEST_MODE 1` เฉพาะตอนทดสอบบนโต๊ะ หรือ `0` สำหรับรอบภาคสนาม
2. อัปโหลด `sensor_node/sensor_node.ino` เป็น `NODE01`
3. อัปโหลด `sensor_node_2/sensor_node_2.ino` เป็น `NODE02`
4. คัดลอก `gateway/secrets.example.h` เป็น `gateway/secrets.h` แล้วตั้ง Backend URL/API key
5. อัปโหลด `gateway/gateway.ino` และตั้ง Wi-Fi ผ่านหน้า `Wildfire-Gateway-*`

อย่าถือผลการทดสอบซอฟต์แวร์แทนการสอบเทียบเซนเซอร์ การทดสอบระยะ LoRa และการทดสอบไฟเลี้ยงจริง

## คำสั่งตรวจโครงการ

```powershell
node tools/test_node_risk.mjs
cd wildfire-backend
npm test
cd ..\wildfire-dashboard
npm test
npm run lint
npm run build
```

สำหรับ Arduino CLI ให้เพิ่มคลังที่ติดตั้งไว้และคอมไพล์ทั้งสามสเก็ตช์ด้วย FQBN เดียวกัน

## Domain deployment

ระบบโดเมนใช้ Backend ตัวเดียวเผยแพร่สอง hostname ผ่าน Cloudflare Tunnel:

- `https://wildfire.nattaphat.me` เป็น Dashboard อ่านอย่างเดียว
- `https://admin.nattaphat.me` ป้องกันด้วย Cloudflare Access สำหรับ GPS, ตำแหน่ง manual และจัดการ Alert

เริ่มระบบเวอร์ชันโดเมนด้วย:

```powershell
cd C:\wildfire_lora
.\start-domain.ps1
```

รายละเอียด Gateway และการตั้ง Wi-Fi อยู่ใน [`gateway/README.md`](gateway/README.md)

คำอธิบายโฟลเดอร์ ไฟล์ และฟังก์ชันสำคัญอยู่ใน [`docs/code-structure.md`](docs/code-structure.md)

โครงสร้าง Collection, field และ index ของ MongoDB อยู่ใน [`docs/database-schema.md`](docs/database-schema.md)
