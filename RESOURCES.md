# Wildfire LoRa API Resources

## Knowledge

- [Arduino: Sketch build process](https://docs.arduino.cc/arduino-cli/sketch-build-process)
  อธิบายขั้นตอนเตรียมไฟล์ `.ino`, การ include และการคอมไพล์ก่อนนำโปรแกรมลงบอร์ด
- [Espressif Arduino ESP32 core: main.cpp](https://github.com/espressif/arduino-esp32/blob/master/cores/esp32/main.cpp)
  โค้ดต้นทางที่เรียก `setup()` หนึ่งครั้ง แล้วเรียก `loop()` ภายในวงวนของ ESP32
- [GCC: Include Operation](https://gcc.gnu.org/onlinedocs/cpp/Include-Operation.html)
  อธิบายว่า `#include` นำเนื้อหาของไฟล์เข้ากระบวนการเตรียมโค้ดก่อนคอมไพล์ ไม่ใช่คำสั่งที่รันในแต่ละรอบ
- [GCC: Conditionals](https://gcc.gnu.org/onlinedocs/cpp/Conditionals.html)
  ใช้แยกเงื่อนไขตอนคอมไพล์อย่าง `#if USE_GPS` ออกจาก `if` ที่ตรวจค่าขณะโปรแกรมทำงาน
- [Espressif: ESP32 Sleep Modes](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/sleep_modes.html)
  อธิบายการตื่นจาก deep sleep และการโหลดโปรแกรมใหม่ ซึ่งทำให้ `setup()` ถูกเรียกอีกครั้ง

- [Microsoft Learn: Azure Virtual Machines overview](https://learn.microsoft.com/azure/virtual-machines/overview)
  Primary reference for what an Azure VM contains, including compute, disks, networking, and operating-system responsibilities.
- [Microsoft Learn: Connect to a Linux VM](https://learn.microsoft.com/azure/virtual-machines/linux-vm-connect)
  Primary reference for SSH access, public IP, port 22, usernames, and private keys.
- [Docker Docs: What is a container?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/)
  Primary reference for containers as isolated processes and for interpreting `docker ps`.
- [Docker Docs: What is an image?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/)
  Primary reference for images as immutable packages used to create containers.
- [Docker Docs: Volumes](https://docs.docker.com/engine/storage/volumes/)
  Primary reference for persistent container data, named volumes, lifecycle, backup, and removal risks.
- [Cloudflare Docs: Tunnel](https://developers.cloudflare.com/tunnel/)
  Primary reference for the outbound-only `cloudflared` connection used to route public hostnames to internal services.

- [Backend Architecture & Guide](file:///c:/wildfire_lora/wildfire-backend/README.md)
  Overview of backend requirements, environment variables, API endpoints, Telegram bot setup, and manual testing.
- [Code Structure Documentation](file:///c:/wildfire_lora/docs/code-structure.md)
  System-wide architecture map connecting Gateway HTTP, Express server, models, services, and dashboard.
- [Database Schema Documentation](file:///c:/wildfire_lora/docs/database-schema.md)
  Detailed schema definitions and indexes for `nodes`, `readings`, `alerts`, and `commands`.
- [Firmware Risk Rules](file:///c:/wildfire_lora/docs/node-risk-rules.md)
  Documentation on why the API trusts the firmware's edge calculation (`st`) without recalculating formulas.
- [Express.js Documentation](https://expressjs.com)
  Reference for Express routing, middleware chaining, and error handling.
- [MongoDB Aggregation Guide](https://www.mongodb.com/docs/manual/aggregation/)
  Reference for `$group`, `$sort`, and time-bucketing formulas used in the readings API.

## Wisdom (Communities)

- [ESP32 & LoRa Community](https://esp32.com/)
  Hardware-to-gateway patterns, deep-sleep timing, and packet serialization.
- [Node.js / Express Community](https://github.com/expressjs/express)
  Production REST API patterns, security middleware, and idempotency.
