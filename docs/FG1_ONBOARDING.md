# FG1: ใช้บอร์ดเดิม เพิ่มการยืนยันตัวตนและจัดการ NODE01–NODE10

สถานะ ณ 1 ตุลาคม 2569: Backend / Dashboard FG1 deploy บน VM แล้ว (`api_version: 3`)
ทดสอบ Backend 24 รายการในรอบก่อน; Dashboard ล่าสุด 16 รายการ และ TypeScript / production build ผ่าน
ตรวจจากเครื่องผู้ใช้แล้ว: Dashboard HTTP 200, API / MongoDB พร้อม และ master key สำหรับลงทะเบียนตั้งค่าแล้ว
เฟิร์มแวร์โหนดคอมไพล์ด้วย ESP32 core 3.3.6 และ `esp32:esp32:ttgo-lora32:FlashFreq=40` แล้ว
ยังไม่ได้อัปลงบอร์ดจริงหรือทดสอบ USB / LoRa ครบเส้นทาง และยังต้องเตรียม / อัป Gateway FG1
ปุ่มเพิ่ม / คืนโหนดติดตั้ง FG1 แล้วตั้งค่ารหัสและกุญแจต่อโดยอัตโนมัติ ไม่ต้องติดตั้งแยกหน้า
การ deploy ครั้งนี้ไม่สร้าง backup ระบบเก่าตามคำขอ แต่คง MongoDB / ประวัติและค่าลับเดิมไว้
หลังเปลี่ยน Backend โหนด legacy ไม่สามารถส่งข้อมูลใหม่ได้ ต้องเตรียม firmware FG1 ทั้ง Gateway และโหนดก่อน

## ขอบเขต

- ใช้ Gateway เดิม ESP32 + SX127x และ LoRa 433 MHz ไม่ใช่ LoRaWAN
- ใช้ `provisioned_sensor/provisioned_sensor.ino` เป็น firmware กลางของโหนดทั้งสิบเลข
- Admin ยืนยันตัวตนผ่าน Cloudflare Access ตาม middleware เดิม
- Admin กดปุ่มในแถว `NODE01–NODE10` โดยไม่ต้องกรอกเลข; `NODE01` เป็นรหัสของจุดข้อมูล/ประวัติ ไม่ใช่หมายเลขฮาร์ดแวร์
- ตั้งค่าผ่าน USB / Web Serial โดยไม่แก้ source และไม่ส่งกุญแจลับทาง LoRa
- ลบ = ซ่อน + เพิกถอนกุญแจ ไม่ลบ Node document, readings หรือ alerts
- คืนเลขเดิม = Node document / ประวัติเดิม แต่กุญแจใหม่และ snapshot ว่าง ต้องรอข้อมูลใหม่
- เพิ่มเลขที่ยังใช้งานอยู่ถูกปฏิเสธ; ปุ่มติดตั้งใหม่ต้องยืนยันก่อนยกเลิกกุญแจเดิม
- USB ล้มเหลวหรือยังไม่ activate = pending ไม่มีสิทธิ์ส่งข้อมูล การตั้งค่าหมดอายุใน 10 นาที

## เฟิร์มแวร์และเว็บ

`sensor_node`, `sensor_node_2` และ range-test เดิมเก็บไว้เป็น legacy ไม่แก้ config ของผู้ใช้
โปรแกรม legacy จะส่งเข้า Backend / Gateway FG1 ไม่ได้ ต้องอัปโหลด managed firmware ก่อน
ใช้บอร์ด LILYGO LoRa32 ESP32 433 MHz และ wiring ใน `sensor_common/sensor_config.h` เท่านั้น
Web installer ตรวจ chip family ESP32 ได้ แต่ตรวจ RF band / wiring แทนคนไม่ได้

หน้า Admin `#admin-nodes`: เสียบ USB → ยืนยันบอร์ดโหนด → กดปุ่มในแถว NODE → เลือกพอร์ตครั้งเดียว
เว็บใช้ `esptool-js@0.6.0` ติดตั้ง FG1 แล้วตรวจข้อมูลในแฟลชก่อนเปิดพอร์ตเดิมเพื่อส่ง `FG_SETUP`
เมื่อบอร์ดตอบ `FG1_READY` จึง reserve กุญแจ เขียน config ตรวจ proof และ activate ต่อเอง
ถ้าติดตั้ง / checksum / รุ่นบอร์ดไม่ผ่าน จะไม่เรียก API reserve และไม่ยกเลิก credential เดิม
การตั้ง config ไม่ใช่การอัปโปรแกรมครั้งที่สอง และไม่ใช้ Wi-Fi บนโหนด
หน้าติดตั้งเดิม `/firmware/index.html` เป็นคำแนะนำให้กลับมากดปุ่มรวมในหน้า Admin
Web Serial ต้องเป็น secure context (HTTPS หรือ localhost) และเบราว์เซอร์ที่รองรับ
ต้องปิด Arduino Serial Monitor และใช้สาย USB ที่ส่งข้อมูลได้
เฟิร์มแวร์มีช่วงตั้งค่า 10 วินาทีหลัง cold reset; `FG_SETUP` ทำให้รอ USB ต่อ
ถ้าไม่มีการลงทะเบียนจะรอ USB และไม่เริ่มส่งข้อมูล

ผู้พัฒนา build `provisioned_sensor` ด้วย Arduino CLI / ESP32 core 3.3.6 และ FQBN ด้านบน
ใช้ `scripts/publish-node-firmware.ps1` ระบุ `BuildDirectory` ที่มี `build.options.json` กับไฟล์ .bin
และ `BootAppFirmware` จาก `tools/partitions/boot_app0.bin` ของ core ที่ใช้ build
สคริปต์ตรวจ profile, header และ default partition table; สร้าง manifest / SHA-256 / MD5
เขียนแยก bootloader 0x1000, partitions 0x8000, boot_app 0xe000 และ app 0x10000 ไม่ใช้ merged padding ทับ NVS
ไม่ erase flash ทั้งหมด และคง durable counter / NVS เดิม; config ใหม่จะเปลี่ยน key/generation ตาม registration
สำรองไฟล์เผยแพร่เดิมเฉพาะใน `.codex-build/firmware-releases` ไม่เผยแพร่ backup ให้เว็บ
สคริปต์ไม่ดาวน์โหลด ไม่ build ไม่ flash และไม่ deploy; ไฟล์กับเครื่องมือติดตั้ง self-host ทั้งหมด

## โปรโตคอลและกุญแจ

FG1 เป็น application protocol เฉพาะโครงงาน ใช้ **AES-256-GCM** จาก Node crypto / ESP32 mbedTLS
ไม่ใช่ primitive เข้ารหัสที่เขียนเอง และไม่ใช่โปรโตคอลที่ผ่าน LoRaWAN certification

เฟรม: direction 4 bytes (`FGU1` uplink / `FGD1` reply), slot 1, generation 8,
sequence big-endian 8, encrypted JSON, GCM authentication tag 16
header 21 bytes เป็น AAD; nonce = direction 4 + sequence 8; max frame 255 bytes
JSON plaintext ไม่เกิน 218 bytes และ `id` ต้องตรงกับ slot ใน header
Gateway ส่งเฟรมเดิมแบบ base64 ไป Backend พร้อม RSSI/SNR; Backend ตรวจ GCM ซ้ำเอง
ไม่มี fallback รับ JSON ไม่ยืนยันตัวตน และไม่มี auto-upsert โหนดที่ไม่ลงทะเบียน

key 32 bytes และ generation 8 bytes สุ่มใหม่เมื่อ register / replace / restore
โหนด reserve counter เป็นช่วง 256 ก่อนส่ง บันทึกลง NVS แบบหนึ่ง blob และใช้ RTC ข้าม deep sleep
cold reset ข้ามช่วงที่ reserve ไว้ จึงไม่ใช้ nonce เดิม; NVS เขียนไม่ได้จะไม่ส่ง
Gateway เก็บ high-watermark ต่อ slot/generation ลง NVS ก่อน ACK และ Backend ใช้ atomic CAS ใน MongoDB
downlink เป็น **หนึ่ง reply ต่อหนึ่ง uplink** รวม ACK กับคำสั่ง เพื่อไม่ใช้ GCM nonce เดิมกับข้อความต่างกัน
โหนดรับเฉพาะ reply ของ generation และ sequence ที่เพิ่งส่ง และรับได้ครั้งเดียวในรอบนั้น
รองรับ **Gateway ที่ไว้ใจหนึ่งตัวเท่านั้น**; หลาย Gateway ต้องออกแบบ key/nonce domains ใหม่ก่อน
ช่วงรับของ managed node เพิ่มจาก legacy 6 วินาทีเป็น 16 วินาที เพราะ airtime SF12 ของ encrypted reply
รอบ WARNING เป้าหมาย 20 วินาทีอาจทำไม่ได้เมื่อรวม airtime/random delay ต้องวัดจริง ไม่กล่าวอ้างคาบที่ยังไม่ทดสอบ

`GATEWAY_API_KEY` เดิมยังยืนยัน Gateway ↔ Backend ผ่าน HTTPS
Backend ต้องเพิ่ม `DEVICE_REGISTRY_KEY` เป็น random 32 bytes (64 lowercase hex) แยกจาก key เดิม
ใช้ master key นี้เข้ารหัส key ประจำโหนดใน MongoDB ด้วย AES-GCM และ AAD node_id/generation
อย่าคัดลอก master key ไป frontend/firmware/git และต้องสำรองแยกอย่างปลอดภัย
master key หาย = เปิด node keys เดิมไม่ได้ ต้อง provision โหนดใหม่

Gateway ดึงกุญแจเฉพาะ active nodes ทุกประมาณ 10 วินาทีผ่าน HTTPS ที่ตรวจ CA
cache มีอายุสูงสุด 30 วินาที ถ้าซิงก์ไม่สำเร็จจะหยุดรับโหนดเมื่อ cache หมดอายุ
Backend เพิกถอนทันที; Gateway อาจยัง ACK ด้วย cache เก่าชั่วคราว แต่ Backend ไม่รับ key ที่เพิกถอนแล้ว
key อยู่ใน RAM Gateway และ NVS โหนด ไม่มีการรับประกันป้องกันผู้ที่อ่าน flash ทางกายภาพ
NVS encryption / secure boot / flash encryption ยังไม่ได้เปิดใช้งาน
ผู้ที่ยึด admin, master key หรือ trusted Gateway อาจยึด node credentials ได้
LoRa ยังอาจชนกันหรือถูกกวนคลื่นได้ การยืนยันตัวตนไม่รับประกันส่งถึงทุกครั้ง
ACK ยืนยันว่า Gateway ตรวจแล้วและเข้าคิว ไม่ใช่หลักฐานว่าบันทึก MongoDB หรือส่ง Telegram สำเร็จ

## API

| Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|
| GET /api/devices | Admin | รายการโหนด รวม archived/pending ไม่มี secret |
| POST /api/devices | Admin | reserve slot และสร้าง config ชั่วคราวสำหรับ USB |
| POST /api/devices/NODE01/activate | Admin | ตรวจ HMAC proof จากบอร์ด เปิดใช้งานก่อนหมดอายุ |
| DELETE /api/devices/NODE01 | Admin | ซ่อน เพิกถอน และยกเลิกคำสั่งของ credential เดิม |
| GET /api/devices/gateway | Gateway key | ซิงก์ active credentials ผ่าน TLS, no-store |
| POST /api/packets | Gateway key + FG1 frame | ตรวจ node authentication / replay / lifecycle ก่อนบันทึก |

คำสั่ง GPS ผูกกับ credential_generation; acknowledgement ต้องเป็น authenticated `cmd_ack`
ที่ส่งผ่าน /api/packets ไม่ยอมรับ ACK แบบเดิมที่ระบุเพียง command_id ผ่าน /commands/:id/ack

## ตรวจรับก่อนเปลี่ยนระบบจริง

1. รัน backend tests และ dashboard tests/typecheck/build ใน environment ทดสอบที่ปลอดภัย
2. Compile generic node และ Gateway; ตรวจขนาด flash/stack และใช้ test vector เทียบ Node crypto ↔ mbedTLS
3. ใช้ฐานข้อมูลทดสอบ: register 1 และ 10, reject 0/11/1.5, reject non-admin และ active slot ซ้ำ
4. ทดสอบ USB permission cancel, wrong firmware, unplug, timeout, pending expiry และ activate proof ผิด
5. ส่ง valid frame, key ผิด, header/payload/tag เปลี่ยน, plaintext legacy, replay และ frame ยาวเกิน 255
6. รีเซ็ต/ตัดไฟ node และ Gateway แล้วส่งเฟรมเก่า; ต้องไม่มี nonce ซ้ำและไม่บันทึกข้อมูลซ้ำ
7. ลบ NODE01 แล้วทดสอบ key เก่า; คืนเลข 1 แล้วตรวจ _id/history เดิม, key ใหม่, online=false จนมีข้อมูลใหม่
8. ทดสอบสอง Admin ทำงานพร้อมกันและ packets ที่เข้าระหว่าง delete/restore
9. ทดสอบ GPS downlink/ACK และ SF12 WARNING หลายโหนด พร้อมจับเวลาจริง
10. ตรวจว่า public APIs/logs/localStorage ไม่มี secret และ key sync cache หมดอายุเมื่อ server หาย

## Migration / backup / rollback

อย่า deploy Backend FG1 โดยยังไม่เตรียม firmware เพราะ legacy packets จะถูกปฏิเสธและข้อมูลสดหยุด
สำรอง MongoDB, deployment/firmware revision เดิม และ master key แยกอย่างปลอดภัยก่อนเปลี่ยนจริง
จัดช่วงเปลี่ยนระบบ: ทดสอบ → เตรียม binary → ตั้ง environment → deploy ที่ประสานกับการ flash → provision
ไม่แก้ timestamp / readings / ตารางผลทดสอบย้อนหลัง และไม่กล่าวอ้างว่า deploy แล้ว
ถ้าต้อง rollback ให้คืน Backend/Gateway/node firmware เวอร์ชันเดียวกันพร้อม configuration ที่เข้ากัน
การคืน legacy version คือกลับไป **ไม่มี node authentication** ต้องแจ้งข้อจำกัดนี้ด้วย
ห้าม restore node NVS/counter เก่าพร้อม key เดิมแล้วส่งต่อ เพราะเสี่ยง GCM nonce reuse
ถ้า erase/restore Gateway NVS จน high-watermark หาย ให้เพิกถอนและออก key ใหม่ให้ทุกโหนดก่อนรับต่อ
หลัง restore ฐานข้อมูลหรือเสีย counter state ให้เพิกถอนและ provision ด้วย key/generation ใหม่ก่อนเปิดรับ

อ้างอิง: https://github.com/espressif/esptool-js และเอกสาร mbedTLS ใน ESP32 core ที่ติดตั้ง
