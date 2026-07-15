# Wildfire LoRa Firmware - Robust No-DS18B20 Build

เวอร์ชันนี้เป็นโค้ดฐานสำหรับระบบต้นแบบแจ้งเตือนไฟป่าระยะเริ่มต้น โดยใช้:

- TTGO LoRa32 1 ตัวเป็น Gateway
- TTGO LoRa32 2 ตัวเป็น Sensor Node (`NODE01`, `NODE02`)
- SHT31 สำหรับอุณหภูมิอากาศ/ความชื้น
- Sharp GP2Y1014AU0F สำหรับอนุภาค/ควัน
- ไม่ใช้ DS18B20 เป็นค่าเริ่มต้น (`USE_DS18B20 0`)

ความถี่ตั้งไว้เป็น `433E6` ตามบอร์ด/เสาที่ใช้อยู่ตอนนี้

---

## สิ่งที่แก้เพิ่มจาก baseline-fix เดิม

### 1. Baseline warm-up

ระบบจะไม่เอาค่ารอบแรกมาตั้งเป็น baseline ทันที แต่จะเก็บค่าปกติหลายรอบก่อน

```cpp
#define BASELINE_WARMUP_CYCLES 5
```

ใน TEST_MODE ค่าเริ่มต้นคือ 5 รอบ หรือประมาณ 25 วินาทีถ้าอ่านทุก 5 วินาที

ถ้าระหว่างเปิดเครื่องมีค่าผิดปกติ เช่น ควันสูงมาก อุณหภูมิสูงมาก หรือความชื้นต่ำมาก ระบบจะไม่เรียนค่านั้นเป็น baseline ปกติ

### 2. Critical debounce

ถ้าระบบเห็นเงื่อนไข CRITICAL แค่รอบเดียว จะยังไม่แดงทันที แต่จะขึ้น WARNING ก่อน และต้องเจอ CRITICAL ต่อเนื่องตามจำนวนรอบที่ตั้งไว้

```cpp
#define CRITICAL_CONFIRM_CYCLES 2
```

### 3. ห้าม CRITICAL ถ้าไม่มีควันร่วม

เพราะเวอร์ชันนี้ไม่มี DS18B20 แล้ว จึงต้องระวังแดด/กล่องร้อน/ความชื้นต่ำหลอกระบบ

```cpp
#define REQUIRE_SMOKE_FOR_CRITICAL 1
```

ถ้าไม่มีควันหรืออนุภาคร่วม ระบบจะไม่ขึ้น CRITICAL จากความร้อน + ความแห้งอย่างเดียว แต่จะถือเป็น WATCH/WARNING แทน

### 4. Rate-of-change ต่อเวลา

เดิม delta เทียบกับรอบก่อนอาจเพี้ยนเมื่อเปลี่ยนจาก TEST_MODE เป็น DEPLOY_MODE เพราะระยะห่างของรอบอ่านไม่เท่ากัน

เวอร์ชันนี้คำนวณ rate ต่อหนึ่งนาที เช่น:

- smoke rate ต่อ 1 นาที
- air temperature rate ต่อ 1 นาที
- humidity drop rate ต่อ 1 นาที

### 5. Sharp health check

เพิ่มการตรวจค่า Sharp ที่ผิดปกติ เช่น:

- ค่าใกล้ 0 ค้างหลายรอบ
- ค่าใกล้ 4095 ค้างหลายรอบ
- ค่าแทบไม่เปลี่ยนเลยนานผิดปกติ

ถ้าเจอจะขึ้น `SENSOR_FAULT`

### 6. Gateway แสดง baseline delta

Gateway จะแสดงค่า:

- Smoke From Baseline (`sr`)
- Air From Baseline (`ar`)
- Humidity From Baseline (`hr`)
- Groups (`g`)
- Baseline Warmup Count (`bc`)

เพื่อใช้ debug ว่าทำไมระบบขึ้น WATCH/WARNING/CRITICAL

---

## โครงสร้างไฟล์

```text
wildfire_lora_no_ds18b20_robust/
  sensor_node/
    sensor_node.ino
    config.h
  gateway/
    gateway.ino
    config.h
  README.md
  CODEX_NEXT_STEPS.md
```

---

## ไลบรารีที่ต้องติดตั้ง

ติดตั้งผ่าน Arduino Library Manager:

1. LoRa by Sandeep Mistry
2. ArduinoJson by Benoit Blanchon
3. Adafruit SHT31 Library
4. Adafruit BusIO

ไม่ต้องติดตั้ง OneWire/DallasTemperature ถ้า `USE_DS18B20` ยังเป็น 0

---

## วิธีอัปโหลด

### Gateway

เปิด:

```text
gateway/gateway.ino
```

อัปโหลดลง TTGO ตัวที่เป็น Gateway แล้วเปิด Serial Monitor ที่ 115200

### NODE01

เปิด:

```text
sensor_node/sensor_node.ino
```

ใน `sensor_node/config.h` ตั้ง:

```cpp
#define NODE_ID "NODE01"
#define USE_DS18B20 0
#define LORA_FREQUENCY 433E6
```

อัปโหลดลง Node ตัวแรก

### NODE02

แก้ `NODE_ID` เป็น:

```cpp
#define NODE_ID "NODE02"
```

แล้วอัปโหลดลง Node ตัวที่สอง

---

## ระดับสถานะ

### CALIBRATING

ระบบกำลังเรียน baseline ยังไม่พร้อมตัดสินเต็มรูปแบบ

### NORMAL

ค่าปกติ ไม่มีสัญญาณควัน/ความร้อน/ความแห้งผิดปกติ

### WATCH

เริ่มมีสัญญาณผิดปกติบางอย่าง แต่ยังไม่ถือว่าเป็นเหตุไฟ

### WARNING

มีสัญญาณผิดปกติชัดเจน หรือมีหลายกลุ่ม sensor สนับสนุนกัน

### CRITICAL

มีควัน/อนุภาคเป็นหนึ่งในหลักฐาน และมี sensor group อื่นช่วยยืนยัน พร้อมผ่าน critical debounce แล้ว

### SENSOR_FAULT

SHT31 หรือ Sharp อ่านค่าผิดปกติ/ขาดหาย/ค้าง

---

## วิธีทดสอบที่แนะนำ

1. เปิด Gateway ก่อน
2. เปิด Node แล้วรอให้ครบ baseline warm-up ประมาณ 5 รอบ
3. ตอนปกติควรเป็น `NORMAL`
4. ใช้ธูป/ควันอ่อน ๆ ทดสอบ Sharp: ควรขึ้น `WATCH` หรือ `WARNING`
5. ใช้ไดร์เป่าห่าง ๆ ทดสอบความร้อน: ถ้าไม่มีควัน ไม่ควรขึ้น `CRITICAL`
6. ใช้ควัน + ความร้อนพร้อมกัน: ควรขึ้น `WARNING` ก่อน แล้วถ้ายืนยันต่อเนื่องจึงขึ้น `CRITICAL`
7. เอาควัน/ความร้อนออก ระบบควรค่อย ๆ ลดระดับ ไม่ตกกลับ NORMAL ทันที

---

## ขอบเขตที่ควรอธิบายในรายงาน

ระบบนี้ควรอธิบายว่า:

> ระบบต้นแบบตรวจจับสัญญาณบ่งชี้ไฟป่าระยะเริ่มต้นจากควัน/อนุภาค อุณหภูมิอากาศ และความชื้น แล้วส่งแจ้งเตือนผ่าน LoRa

ไม่ควรอ้างว่า:

> ตรวจไฟป่าได้ 100% หรือทำนายไฟป่าก่อนเกิดได้แน่นอน

เพราะระบบนี้ยังไม่มี DS18B20 จึงไม่ได้วัดอุณหภูมิดิน/ผิวดินโดยตรง


---

## Quiet-smoke fix update

This build treats `Smoke Raw = 0` as a possible clean-air reading instead of an immediate Sharp sensor fault.

Changed behavior:

- `SHARP_LOW_FAULT_ENABLED` defaults to `0`.
- `SHARP_STUCK_FAULT_ENABLED` defaults to `0`.
- `SHARP_HIGH_FAULT_ENABLED` also defaults to `0`; enable it only after confirming that a near-4095 value always means ADC saturation or a wiring fault on the installed hardware.
- In `TEST_MODE`, runtime RTC counters are reset after every reset/upload so old `BOOT_ABNORMAL` or `SENSOR_FAULT` states do not persist during bench testing.

Important: if your Sharp reads 0 in clean air, verify it responds upward when exposed to a safe smoke source such as incense. If it remains 0 even with smoke, the issue is wiring, LED drive, sensor power, or ADC input.
