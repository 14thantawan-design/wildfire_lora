# โครงสร้าง Backend, MongoDB และ Dashboard

เอกสารนี้อธิบายเฉพาะส่วนที่ทำงานหลังจาก Gateway ส่ง HTTP เข้ามา โดยไม่รวม firmware ของ Sensor Node และ Gateway

```text
Gateway HTTP → Backend → MongoDB → Dashboard
```

## Backend

ตำแหน่ง: `wildfire-backend/src/`

```text
src/
├── server.js
├── db.js
├── middleware/
│   └── security.js
├── models/
│   ├── Node.js
│   ├── Reading.js
│   ├── Alert.js
│   └── Command.js
├── routes/
│   ├── nodes.js
│   ├── readings.js
│   ├── alerts.js
│   ├── commands.js
│   └── readings/
│       ├── adminReadings.js
│       └── readingTools.js
└── services/
    ├── packetHandler.js
    ├── packets/
    │   ├── sensorPacketHandler.js
    │   └── gpsPacketHandler.js
    ├── alertService.js
    ├── commandQueue.js
    ├── gatewayStatus.js
    ├── nodeRisk.js
    └── telegramService.js
```

### จุดเริ่มต้นและความปลอดภัย

| ไฟล์ | ฟังก์ชัน | หน้าที่ |
| --- | --- | --- |
| `server.js` | `start()` | เชื่อม MongoDB แล้วเปิด Express server |
| `server.js` | `shutdown()` | ปิด HTTP และ MongoDB เมื่อ container หยุด |
| `db.js` | `connectDB()` | เชื่อมไปยัง `MONGODB_URI` |
| `middleware/security.js` | `requireGatewayKey()` | ตรวจ API key ของ Gateway |
| `middleware/security.js` | `requireLocalAdmin()` | ป้องกัน API แก้ไข/ลบด้วย Cloudflare Access |

### การรับแพ็กเก็ต

| ไฟล์ | หน้าที่ |
| --- | --- |
| `services/packetHandler.js` | จุดกลางที่เลือก Sensor หรือ GPS handler |
| `services/packets/sensorPacketHandler.js` | คัดลอกค่าจาก JSON ลง Reading/Node และเรียก Alert |
| `services/packets/gpsPacketHandler.js` | อัปเดตพิกัดหรือข้อผิดพลาด GPS ใน Node |

ฟังก์ชันสำคัญ:

- `handlePacket()` เลือก handler จาก `packet.t`
- `handleSensorPacket()` บันทึกทุกข้อมูลวัดเป็น Reading ใหม่
- `handleGpsPacket()` อัปเดตตำแหน่งล่าสุด

### Routes และ Services

| ไฟล์ | หน้าที่ |
| --- | --- |
| `routes/nodes.js` | อ่านโหนด สั่งค้นหา GPS และกำหนดพิกัดเอง |
| `routes/readings.js` | API อ่านค่าล่าสุดและกราฟย้อนหลัง |
| `routes/readings/adminReadings.js` | API ค้นหา แก้ไข และลบ Reading ของ Admin |
| `routes/readings/readingTools.js` | เตรียมค่าที่ Admin แก้ไขและป้องกันการลบผิดรายการ |
| `routes/alerts.js` | อ่านและลบ Alert |
| `routes/commands.js` | Gateway อ่านและรายงานผลคำสั่ง |
| `services/alertService.js` | เปิด อัปเดต และปิด Alert |
| `services/commandQueue.js` | จัดคิวคำสั่ง GPS |
| `services/telegramService.js` | สร้างและส่งข้อความ Telegram |

## MongoDB

Schema อยู่ใน `wildfire-backend/src/models/` และแยกหนึ่งไฟล์ต่อ Collection:

| Model | Collection | หน้าที่ |
| --- | --- | --- |
| `Node.js` | `nodes` | snapshot ล่าสุดของแต่ละโหนด |
| `Reading.js` | `readings` | ประวัติค่าที่วัดทุกครั้ง |
| `Alert.js` | `alerts` | ช่วงเหตุการณ์ผิดปกติ |
| `Command.js` | `commands` | คำสั่ง GPS ที่รอส่ง |

รายละเอียด field, index และความสัมพันธ์ทั้งหมดอยู่ใน [`database-schema.md`](database-schema.md)

## Dashboard

ตำแหน่ง: `wildfire-dashboard/src/`

```text
src/
├── App.tsx
├── useDashboard.ts
├── dashboardView.ts
├── liveOverview.ts
├── types.ts
├── components/
├── admin/
└── styles/
```

### ไฟล์แกนกลาง

| ไฟล์ | หน้าที่ |
| --- | --- |
| `App.tsx` | เก็บ state ที่หลายส่วนใช้ร่วมกันและประกอบหน้า |
| `useDashboard.ts` | เรียก API และรีเฟรชข้อมูลทุก 5 วินาที |
| `dashboardView.ts` | แปลงข้อมูลเป็นข้อความและสถานะแสดงผล |
| `liveOverview.ts` | เลือกเฉพาะโหนดออนไลน์สำหรับข้อมูลสด |
| `types.ts` | ชนิดข้อมูลที่ตรงกับ Backend API |
| `timeRanges.ts` | ช่วงเวลาของกราฟ |

### Components หน้าภาพรวม

| ไฟล์ | หน้าที่ |
| --- | --- |
| `DashboardHeader.tsx` | ชื่อระบบ สถานะ Gateway และปุ่ม Admin |
| `DashboardSummary.tsx` | แถบความปลอดภัยและการ์ดค่าล่าสุด |
| `MonitoringMap.tsx` | กรอบแผนที่และปุ่ม GPS |
| `MapPanel.tsx` | แผนที่ Leaflet และ marker |
| `NodeDetailsCard.tsx` | เลือกโหนดและดูสถานะ |
| `AlertsPanel.tsx` | รายการ Alert ล่าสุด |
| `TrendPanel.tsx` | กรอบกราฟและตัวเลือกโหนด |
| `TrendChart.tsx` | กราฟ Recharts |
| `ManualLocationModal.tsx` | แบบฟอร์มกำหนดพิกัดเอง |

### หน้า Admin

| ไฟล์ | หน้าที่ |
| --- | --- |
| `admin/AdminReadingsPage.tsx` | state ตัวกรอง pagination และการเรียก API |
| `admin/AdminReadingsTable.tsx` | ตาราง Reading และปุ่มแต่ละแถว |
| `admin/ReadingEditorModal.tsx` | แบบฟอร์มแก้ไข Reading |
| `admin/adminReadings.ts` | ชนิดข้อมูล ฟังก์ชัน API และตัวช่วยแปลงค่า |

### CSS

`App.css` ทำหน้าที่ import CSS ตามลำดับเดิม:

- `styles/layout.css` โครงหน้าและแถบหัวเว็บ
- `styles/overview.css` สถานะและค่าล่าสุด
- `styles/location-map.css` GPS, Modal และแผนที่
- `styles/alerts-trends.css` Alert และกราฟ
- `styles/admin.css` ตารางและแบบฟอร์ม Admin
- `styles/responsive.css` โทรศัพท์และแท็บเล็ต

## เส้นทางข้อมูลหนึ่งแพ็กเก็ต

```text
POST /api/packets
  → server.js
  → packetHandler.js
  → sensorPacketHandler.js
  → Reading + Node models
  → MongoDB
  → GET /api/nodes และ /api/readings/:node_id
  → useDashboard.ts
  → React components
```
