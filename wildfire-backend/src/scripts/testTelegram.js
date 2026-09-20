// สคริปต์ทดสอบส่งข้อความ Telegram จากค่าที่กำหนดใน .env
require('dotenv').config();

const {
  isTelegramConfigured,
  sendTelegramMessage
} = require('../services/telegramService');

// ตรวจการตั้งค่า แล้วส่งข้อความทดสอบหนึ่งครั้งพร้อมรายงานผลใน Terminal
async function main() {
  if (!isTelegramConfigured()) {
    console.error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.');
    process.exitCode = 1;
    return;
  }

  const result = await sendTelegramMessage([
    '✅ <b>ทดสอบระบบแจ้งเตือนสำเร็จ</b>',
    '',
    'Backend ของ Wildfire LoRa เชื่อมต่อกับ Telegram Channel แล้ว'
  ].join('\n'));

  if (result.status !== 'sent') {
    process.exitCode = 1;
    return;
  }

  console.log(`Telegram test message sent (message_id=${result.message_id})`);
}

main().catch((error) => {
  console.error(`Telegram test failed: ${error.message}`);
  process.exitCode = 1;
});
