# ForestGuard Dashboard

หน้าเว็บแดชบอร์ดสำหรับระบบ Wildfire LoRa พัฒนาด้วย React, TypeScript และ Vite

## เริ่มใช้งาน

เปิด Backend ก่อน:

```powershell
cd ..\wildfire-backend
npm run dev
```

จากนั้นเปิดอีกหน้าต่างหนึ่งเพื่อรัน Dashboard:

```powershell
cd wildfire-dashboard
npm install
npm run dev
```

เปิด `http://localhost:5173`

ถ้า Backend หรือ MongoDB ยังไม่ทำงาน หน้าเว็บจะสลับไปใช้ข้อมูลตัวอย่างอัตโนมัติ เพื่อให้ดูและพัฒนาดีไซน์ต่อได้

ถ้า PowerShell แจ้งว่าไม่อนุญาตให้รัน `npm.ps1` ให้ใช้ `npm.cmd` แทน `npm` ในคำสั่งข้างต้น

## การเชื่อมต่อ API

ระหว่างพัฒนาบนเครื่อง Vite จะส่งคำขอ `/api` ไปที่ `http://localhost:4000` ให้อัตโนมัติ

เมื่อนำหน้าเว็บขึ้นคนละโดเมนกับ Backend ให้คัดลอก `.env.example` เป็น `.env` แล้วกำหนด:

```text
VITE_API_URL=https://your-api.example.com/api
```

## คำสั่ง

- `npm run dev` เปิดเซิร์ฟเวอร์สำหรับพัฒนา
- `npm run build` ตรวจ TypeScript และสร้างไฟล์สำหรับนำขึ้นระบบ
- `npm run lint` ตรวจคุณภาพโค้ด
- `npm run preview` ดูไฟล์ที่ build แล้ว
