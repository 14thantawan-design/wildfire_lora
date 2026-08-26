# NODE03 LoRa Range Test

เฟิร์มแวร์นี้ใช้กับบอร์ด TTGO / LILYGO LoRa32-OLED ตัวที่สามสำหรับเดินทดสอบ
ระยะสื่อสารกับ Gateway โดยไม่ใช้เซนเซอร์จริงและไม่เข้า Deep sleep

## การทำงาน

- ส่งข้อมูลจำลองในชื่อ `NODE03`
- ใช้ LoRa 433 MHz และค่าการสื่อสารเดียวกับ Gateway หลัก
- รอ ACK จาก Gateway สูงสุด 1.8 วินาทีต่อครั้ง
- ถ้าไม่ได้ ACK จะสุ่มเวลาแล้วลองใหม่ โดยส่งสูงสุดรวม 3 ครั้งต่อรอบ
- ถ้าได้ ACK จะหยุด retry ทันที
- พัก 5 วินาทีหลังจบรอบ แล้วเริ่มรอบใหม่
- แสดงผลการทดสอบบน OLED และ Serial ที่ 115200 baud

Gateway ต้องใช้เฟิร์มแวร์รุ่นที่เปิด `SENSOR_UPLINK_ACK_ENABLED 1` ซึ่งโปรเจกต์หลัก
ปัจจุบันเปิดไว้แล้ว จึงไม่ต้องแก้ Gateway เพิ่มสำหรับ NODE03

## ค่าบน OLED

```text
NODE03 RANGE TEST
SEQ 18 TRY 1/3
ACK: OK GOOD
RSSI: -72 dBm
SNR : 8.5 dB
SUCCESS: 100%
```

- `ACK: OK` หมายถึง Gateway รับ uplink และ NODE03 รับ ACK กลับได้
- `ACK: LOST` หมายถึงไม่ได้ ACK หลังส่งครบ 3 ครั้ง
- `RSSI/SNR` เป็นคุณภาพของ ACK ฝั่ง Gateway -> NODE03 ไม่ใช่ค่า uplink ที่อยู่ในฐานข้อมูล
- `SUCCESS` คือจำนวนรอบที่ได้รับ ACK หารด้วยจำนวนรอบทดสอบทั้งหมด
- `GOOD`, `FAIR`, `WEAK` เป็นคำช่วยอ่านคุณภาพสัญญาณแบบคร่าว ๆ ควรดู Success ร่วมด้วย

## ข้อมูลจำลอง

```text
Temperature: 28.5 C
Humidity:    55.0 %
Smoke:       0 raw
State:       NORMAL
```

ข้อมูลจะปรากฏในระบบเป็น `NODE03` และเป็นข้อมูลจำลองสำหรับทดสอบเท่านั้น

## ไลบรารีที่ใช้

- LoRa
- ArduinoJson
- Adafruit GFX Library
- Adafruit SSD1306

## การอัปโหลด

1. เปิด `sensor_node_3_range_test.ino` ด้วย Arduino IDE
2. เลือกบอร์ด `TTGO LoRa32-OLED`
3. เลือก COM ของบอร์ด NODE03
4. ตรวจว่าเสียบเสาอากาศ 433 MHz แล้ว
5. กด Upload และเปิด Serial Monitor ที่ 115200 หากต้องการดู log เพิ่มเติม

หาก OLED ไม่แสดง ให้ตรวจรุ่นบอร์ดและค่าขาใน `config.h` โดยค่าปัจจุบันสำหรับ
TTGO LoRa32 V1 ใช้ SDA 4, SCL 15, RESET 16 และ I2C address `0x3C`
