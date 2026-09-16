const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DEFAULT_DASHBOARD_URL = 'https://wildfire.nattaphat.me';
const DEFAULT_TIMEZONE = 'Asia/Bangkok';
const REQUEST_TIMEOUT_MS = 5000;

const LEVEL_DETAILS = {
  WATCH: { icon: '🟡', label: 'เฝ้าระวัง' },
  WARNING: { icon: '🟠', label: 'เตือนภัย' },
  SENSOR_FAULT: { icon: '🟣', label: 'เซนเซอร์ขัดข้อง' },
  NORMAL: { icon: '🟢', label: 'ปกติ' }
};

function telegramConfig(env = process.env) {
  return {
    botToken: String(env.TELEGRAM_BOT_TOKEN || '').trim(),
    chatId: String(env.TELEGRAM_CHAT_ID || '').trim(),
    dashboardUrl: String(env.TELEGRAM_DASHBOARD_URL || DEFAULT_DASHBOARD_URL).trim(),
    timezone: String(env.TELEGRAM_TIMEZONE || DEFAULT_TIMEZONE).trim()
  };
}

function isTelegramConfigured(env = process.env) {
  const config = telegramConfig(env);
  return Boolean(config.botToken && config.chatId);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formatValue(value, suffix = '', digits = 1) {
  const number = finiteNumber(value);
  if (number === undefined) return 'ไม่มีข้อมูล';
  return `${number.toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  })}${suffix}`;
}

function formatTimestamp(value, timezone = DEFAULT_TIMEZONE) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  try {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'medium'
    }).format(safeDate);
  } catch (error) {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: DEFAULT_TIMEZONE,
      dateStyle: 'medium',
      timeStyle: 'medium'
    }).format(safeDate);
  }
}

function readingFrom(alert, reading) {
  return reading || alert?.last_reading || {};
}

function buildTelegramMessage(event, alert, reading, options = {}) {
  const config = { ...telegramConfig(), ...options };
  const current = readingFrom(alert, reading);
  const level = event === 'resolved' ? 'NORMAL' : alert?.level || current.state;
  const detail = LEVEL_DETAILS[level] || { icon: '🔔', label: level || 'ไม่ทราบสถานะ' };
  const nodeId = escapeHtml(alert?.node_id || current.node_id || 'ไม่ทราบจุดตรวจ');
  const timestamp = event === 'resolved'
    ? alert?.ended_at || current.timestamp
    : current.timestamp || alert?.started_at;
  const dashboardUrl = escapeHtml(config.dashboardUrl || DEFAULT_DASHBOARD_URL);

  if (event === 'resolved') {
    return [
      `${detail.icon} <b>เหตุการณ์สิ้นสุดแล้ว</b>`,
      '',
      `<b>จุดตรวจ:</b> ${nodeId}`,
      '<b>สถานะปัจจุบัน:</b> NORMAL (ปกติ)',
      'ระบบตรวจพบค่าปกติต่อเนื่องครบตามเงื่อนไขแล้ว',
      `<b>เวลา:</b> ${escapeHtml(formatTimestamp(timestamp, config.timezone))}`,
      '',
      `<a href="${dashboardUrl}">ดูข้อมูลบน Dashboard</a>`
    ].join('\n');
  }

  const heading = event === 'escalated' ? 'แจ้งเตือนยกระดับ' : 'แจ้งเตือนจากระบบ Wildfire LoRa';
  const particleText = formatValue(current.particle_ug_m3, ' µg/m³', 1);

  return [
    `${detail.icon} <b>${heading}: ${escapeHtml(detail.label)}</b>`,
    '',
    `<b>จุดตรวจ:</b> ${nodeId}`,
    `<b>ระดับระบบ:</b> ${escapeHtml(level)} (${escapeHtml(detail.label)})`,
    '',
    `<b>อุณหภูมิ:</b> ${formatValue(current.air_temp, '°C')}`,
    `<b>ความชื้น:</b> ${formatValue(current.humidity, '%')}`,
    `<b>อนุภาคโดยประมาณ:</b> ${particleText}`,
    `<b>เวลา:</b> ${escapeHtml(formatTimestamp(timestamp, config.timezone))}`,
    '',
    `<a href="${dashboardUrl}">ดูตำแหน่งและข้อมูลเพิ่มเติม</a>`
  ].join('\n');
}

async function sendTelegramMessage(text, options = {}) {
  const config = { ...telegramConfig(), ...options };
  if (!config.botToken || !config.chatId) {
    return { status: 'skipped', reason: 'not_configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${TELEGRAM_API_BASE}/bot${encodeURIComponent(config.botToken)}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`Telegram API returned HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.ok) throw new Error('Telegram API rejected the message');
    return { status: 'sent', message_id: result.result?.message_id };
  } catch (error) {
    const message = error.name === 'AbortError' ? 'request timed out' : error.message;
    console.error(`telegram notification failed: ${message}`);
    return { status: 'failed', reason: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyTelegram(event, alert, reading) {
  const text = buildTelegramMessage(event, alert, reading);
  return sendTelegramMessage(text);
}

module.exports = {
  LEVEL_DETAILS,
  buildTelegramMessage,
  escapeHtml,
  isTelegramConfigured,
  notifyTelegram,
  sendTelegramMessage,
  telegramConfig
};
