# โครงสร้างฐานข้อมูล MongoDB

ระบบใช้ฐานข้อมูล `wildfire_lora` ผ่าน Mongoose โดย MongoDB เรียกสิ่งที่ใกล้เคียงกับ “ตาราง” ว่า **Collection** และเรียกข้อมูลแต่ละแถวว่า **Document**

```text
nodes       ค่าล่าสุดของแต่ละโหนด
readings    ประวัติค่าที่วัดทุกครั้ง
alerts      ช่วงเหตุการณ์ผิดปกติ
commands    คำสั่ง GPS ที่รอส่งผ่าน Gateway
```

Schema จริงอยู่ใน `wildfire-backend/src/models/` หนึ่งไฟล์ต่อหนึ่ง Collection ไม่มี Schema ซ้ำอยู่ใน Dashboard

## Collection: nodes

ไฟล์: `wildfire-backend/src/models/Node.js`

มีหนึ่ง Document ต่อหนึ่ง `node_id` ใช้แสดงสถานะล่าสุดโดยไม่ต้องค้นประวัติทั้งหมด

| Field | ชนิด | ความหมาย |
| --- | --- | --- |
| `node_id` | String | รหัสโหนด เช่น `NODE01` และห้ามซ้ำ |
| `state` | String | `UNKNOWN`, `NORMAL`, `WATCH`, `WARNING` หรือ `SENSOR_FAULT` |
| `air_temp` | Mixed | อุณหภูมิล่าสุด หน่วย °C; เก็บค่าที่ได้รับโดยไม่ตรวจช่วง |
| `humidity` | Mixed | ความชื้นสัมพัทธ์ล่าสุด หน่วย %RH; เก็บค่าที่ได้รับโดยไม่ตรวจช่วง |
| `particle_adc` | Mixed | ค่าควัน ADC ล่าสุด; เก็บค่าที่ได้รับโดยไม่ตรวจช่วง |
| `lat`, `lng` | Mixed | พิกัดล่าสุด |
| `gps_fixed` | Boolean | GPS หาพิกัดได้หรือไม่ |
| `gps_error` | String | สาเหตุที่ GPS ยังไม่พร้อม |
| `location_source` | String | ที่มาของพิกัด `gps` หรือ `manual` |
| `location_updated_at` | Date | เวลาที่พิกัดเปลี่ยนล่าสุด |
| `last_seen` | Date | เวลาที่ Backend ได้รับแพ็กเก็ตล่าสุด |
| `report_interval_sec` | Mixed | รอบส่งที่ firmware แจ้งมา หน่วยวินาที |
| `rssi`, `snr` | Mixed | คุณภาพสัญญาณเมื่อมีค่าอยู่ใน JSON |
| `created_at`, `updated_at` | Date | Mongoose เพิ่มให้อัตโนมัติ |

Index สำคัญ: `node_id` เป็น unique index เพื่อไม่ให้หนึ่งโหนดมีหลาย snapshot

## Collection: readings

ไฟล์: `wildfire-backend/src/models/Reading.js`

เพิ่มหนึ่ง Document ทุกครั้งที่ได้รับแพ็กเก็ตเซนเซอร์ ใช้ทำกราฟย้อนหลังและหน้า Admin

| Field | ชนิด | ความหมาย |
| --- | --- | --- |
| `node_id` | String | เจ้าของข้อมูลวัด |
| `report_interval_sec` | Mixed | รอบส่งที่โหนดใช้ |
| `timestamp` | Date | เวลาที่ Backend บันทึกข้อมูล |
| `state` | String | สถานะที่ firmware ประเมินแล้ว |
| `air_temp` | Mixed | อุณหภูมิที่ได้รับโดยไม่ตรวจช่วงหรือชนิด |
| `humidity` | Mixed | ความชื้นที่ได้รับโดยไม่ตรวจช่วงหรือชนิด |
| `particle_adc` | Mixed | ค่า ADC ที่ได้รับโดยไม่ตรวจช่วงหรือชนิด |
| `rssi`, `snr` | Mixed | คุณภาพสัญญาณเมื่อมีค่าอยู่ใน JSON |

Index สำคัญ:

- `{ node_id, timestamp }` ใช้ค้นกราฟย้อนหลัง

ข้อมูลเซนเซอร์ที่ส่งซ้ำจะถูกบันทึกเป็น Reading ใหม่ทุกครั้ง เมื่อเริ่ม Backend ครั้งแรกหลังอัปเดต
ระบบสำรอง collection เป็น `readings_backup_before_simple_packets` แล้วถอด unique index เก่า

## Collection: alerts

ไฟล์: `wildfire-backend/src/models/Alert.js`

หนึ่ง Document แทน “หนึ่งช่วงเหตุการณ์” ตั้งแต่เริ่มผิดปกติจนกลับสู่ปกติ

| Field | ชนิด | ความหมาย |
| --- | --- | --- |
| `node_id` | String | โหนดที่เกิดเหตุการณ์ |
| `level` | String | ระดับปัจจุบันของเหตุการณ์ |
| `max_state` | String | ระดับสูงสุดที่เคยเกิดในช่วงนี้ |
| `started_at` | Date | เวลาเริ่มเหตุการณ์ |
| `ended_at` | Date | เวลาสิ้นสุดเหตุการณ์ |
| `active` | Boolean | เหตุการณ์ยังดำเนินอยู่หรือไม่ |
| `message` | String | ข้อความอธิบาย |
| `last_reading` | Object | สำเนาค่าวัดล่าสุดที่เกี่ยวข้องกับ Alert |
| `telegram_notified_level` | String | ระดับล่าสุดที่แจ้ง Telegram แล้ว |
| `telegram_notified_at` | Date | เวลาที่แจ้งล่าสุด |
| `telegram_resolved_notified_at` | Date | เวลาที่แจ้งว่ากลับสู่ปกติ |
| `telegram_last_error` | String | ข้อผิดพลาดจาก Telegram ครั้งล่าสุด |

Partial unique index บังคับให้แต่ละโหนดมี Alert ที่ `active: true` ได้เพียงหนึ่ง Document

## Collection: commands

ไฟล์: `wildfire-backend/src/models/Command.js`

เก็บคำสั่งที่ Backend รอให้ Gateway นำไปส่งตอนโหนดตื่น

| Field | ชนิด | ความหมาย |
| --- | --- | --- |
| `command_id` | String | รหัสคำสั่งที่ห้ามซ้ำ |
| `node_id` | String | โหนดปลายทาง |
| `command` | String | `gps_reacquire` หรือ `gps_manual` |
| `status` | String | `pending`, `sent`, `acknowledged` หรือ `rejected` |
| `sent_at` | Date | เวลาที่ Gateway รายงานว่าส่งแล้ว |
| `acknowledged_at` | Date | เวลาที่โหนดตอบ ACK |
| `completed_at` | Date | เวลาที่คำสั่งเสร็จสิ้น |
| `result_reason` | String | เหตุผลเมื่อปฏิเสธหรือทำไม่สำเร็จ |
| `attempts` | Number | จำนวนครั้งที่พยายามส่ง |
| `expires_at` | Date | เวลาหมดอายุของคำสั่ง |

TTL index ที่ `expires_at` ทำให้ MongoDB ลบคำสั่งที่หมดอายุให้อัตโนมัติ

## ความสัมพันธ์ของข้อมูล

MongoDB ไม่มี foreign key แบบ SQL แต่ Collection เชื่อมกันด้วย `node_id`:

```text
nodes.node_id
   ├── readings.node_id
   ├── alerts.node_id
   └── commands.node_id
```

การลบ Reading จากหน้า Admin ไม่ลบ Node, Alert หรือ Command ตามไปด้วย เพราะแต่ละ Collection มีหน้าที่ต่างกัน

## เส้นทางการบันทึกข้อมูล

```text
POST /api/packets
  → packetHandler.js เลือกชนิดแพ็กเก็ต
  → sensorPacketHandler.js หรือ gpsPacketHandler.js
  → Mongoose Model
  → MongoDB Collection
```

Backend เชื่อมฐานข้อมูลผ่าน `wildfire-backend/src/db.js` โดยอ่าน URL จาก `MONGODB_URI` ใน `.env`
