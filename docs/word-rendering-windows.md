# การเรนเดอร์เล่ม Word บน Windows

แก้ไขเมื่อ 13 กันยายน 2569 โดยเพิ่มทางสำรองในโปรเจค ไม่แก้ชุดเครื่องมือที่ Codex จัดการ และไม่ติดตั้ง LibreOffice หรือเปลี่ยน PATH ของเครื่อง

## สาเหตุเดิม

ชุด dependencies ของ Codex รุ่น `26.909.12148` บน Windows ระบุ `libreOfficeVersion: null` และไม่มี LibreOffice อยู่ในรายการ native dependencies ขณะที่สคริปต์ `render_docx.py` ต้องใช้ `soffice.exe` เพื่อแปลง DOCX เป็น PDF ก่อนสร้างภาพ จึงเกิด `FileNotFoundError` ก่อนอ่านรูปแบบหน้า ไม่ใช่หลักฐานว่าไฟล์เล่มเสีย

สกิลเอกสารกำหนดให้ใช้ LibreOffice จากชุด runtime แต่ชุด Windows นี้ไม่มีตัวโปรแกรม จึงไม่ได้ติดตั้งหรือใช้ LibreOffice desktop แทน ทางสำรองใช้ Microsoft Word ที่มีอยู่ในเครื่องผ่าน API แปลงไฟล์แบบไม่ควบคุมหน้าจอ แล้วใช้ส่วน PDF → PNG ของสคริปต์เรนเดอร์เดิมและ Poppler ที่มากับ Codex

## วิธีใช้งาน

บันทึกงานและปิด Microsoft Word ก่อนเรียกใช้ เครื่องมือนี้จะไม่ทำงานร่วมกับ Word session ที่เปิดอยู่ เพื่อไม่กระทบเอกสารและการตั้งค่าของผู้ใช้

ใช้ Python และตำแหน่งสกิลที่ได้จาก `load_workspace_dependencies` ของรอบปัจจุบัน ตัวอย่างสำหรับเครื่องนี้:

```powershell
$env:PYTHONUTF8 = '1'
& 'C:\Users\14tha\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' `
  'C:\wildfire_lora\tools\render_docx_windows.py' `
  'C:\wildfire_lora\เล่มปริญญานิพนธ์\รวมทุกบทฉบับไม่สมบูรณ์.docx' `
  --renderer 'C:\Users\14tha\.codex\plugins\cache\openai-primary-runtime\documents\26.909.12148\skills\documents\render_docx.py' `
  --output_dir 'C:\wildfire_lora\tmp\thesis-word-render-next' `
  --emit_pdf --verbose
```

โฟลเดอร์ output ต้องเป็นโฟลเดอร์ใหม่หรือว่าง เครื่องมือไม่เขียนทับผลเดิม ใช้ `--dpi` ปรับความละเอียด (ค่าเริ่มต้น 140) และ `--timeout` ปรับเวลารอ Word (ค่าเริ่มต้น 180 วินาที)

ถ้าเรียกผ่าน Codex sandbox แล้วพบ COM error `0x80070520` ต้องอนุญาตเฉพาะคำสั่งแปลงนี้ให้ทำงานนอก sandbox ด้วยเครื่องมือขอสิทธิ์ตามปกติ ไม่ต้องแก้สิทธิ์ Windows, DCOM, Trust Center หรือปิดระบบความปลอดภัย

## การรักษาต้นฉบับและขอบเขต

- เปิดเฉพาะสำเนาชั่วคราวใน Word แบบ read-only และไม่เพิ่มเข้ารายการไฟล์ล่าสุด
- ไม่เรียก Save กลับ DOCX ไม่แก้เนื้อหา ไม่สั่งอัปเดตฟิลด์ทั้งหมด และตรวจ SHA-256 ของต้นฉบับก่อน–หลัง
- ปิดการทำงานของ macro และการอัปเดตลิงก์เฉพาะช่วงแปลง คืนค่าที่เปลี่ยนก่อนออกจาก Word
- ปฏิเสธเอกสารมี macro หรือความสัมพันธ์โหลดทรัพยากรภายนอก เช่น attached template และภาพภายนอก ส่วน hyperlink ปกติไม่ถูกเปิด
- ไม่อัปโหลดเอกสาร ไม่ติดตั้งโปรแกรมเพิ่ม และไม่บังคับปิด Word ของผู้ใช้ หาก Word ค้างหรือมีเอกสารอื่นเปิดระหว่างแปลง ต้องตรวจเองก่อนลองใหม่
- ผล PDF/PNG ใน `tmp/` เป็นไฟล์สำหรับตรวจภายใน ไม่ใช่เล่มฉบับแก้ไขหรือเอกสารที่ยืนยันว่ารูปแบบถูกต้องทั้งหมด

## ผลทดสอบกับเล่มจริง

- ไฟล์ `รวมทุกบทฉบับไม่สมบูรณ์.docx` แปลงด้วย Word ได้ **101 หน้า**
- สร้าง PNG ครบทั้ง 101 หน้า ไม่มีไฟล์หายหรือไฟล์ภาพเสียจากการตรวจโครงสร้างภาพ
- เปิดตรวจตัวอย่างหน้าข้อความภาษาไทยและตารางผลทดลองได้จริง การทดสอบนี้ยังไม่ใช่การตรวจรูปแบบทุกหน้าครบทั้งเล่ม
- SHA-256 ต้นฉบับก่อน–หลังตรงกัน: `d9f09ba49f919d114d8d1f613e2d20213385b045f5c4f899273a49d767f4fd09`
- Unit tests สำหรับการตรวจ input และกรณีแปลงผิดพลาดผ่าน 12 ข้อ โดยชุด unit tests ไม่เปิด Word
- ผลการแปลงและข้อมูลยืนยันเก็บใน `C:\wildfire_lora\tmp\thesis-word-render-2026-09-13\render-summary.json` โฟลเดอร์ผลทั้งหมดมีขนาดประมาณ 30 MB

เรียกชุดทดสอบ:

```powershell
& 'C:\Users\14tha\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' `
  'C:\wildfire_lora\tools\test_render_docx_windows.py'
```

ไฟล์ที่เกี่ยวข้อง: [ตัวเรียกเรนเดอร์](C:/wildfire_lora/tools/render_docx_windows.py), [ตัวแปลง Word เป็น PDF](C:/wildfire_lora/tools/export_word_pdf.ps1), [ชุดทดสอบ](C:/wildfire_lora/tools/test_render_docx_windows.py)

API อ้างอิงของ Microsoft: [Documents.Open สำหรับเปิดแบบอ่านอย่างเดียว](https://learn.microsoft.com/en-us/office/vba/api/word.documents.open), [ExportAsFixedFormat สำหรับส่งออก PDF](https://learn.microsoft.com/en-us/office/vba/api/word.document.exportasfixedformat), [AutomationSecurity สำหรับการเปิดเอกสารผ่านโปรแกรม](https://learn.microsoft.com/en-us/office/vba/api/word.application.automationsecurity)
