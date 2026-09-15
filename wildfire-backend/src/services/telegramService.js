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

const REASON_LABELS = {
  node_reported: 'ใช้สถานะที่โหนดประเมินส่งมา',
  temperature_above_45: 'อุณหภูมิสูงกว่า 45°C',
  particle_above_150: 'อนุภาคโดยประมาณสูงกว่า 150 µg/m³',
  hot_dry_30_30: 'อุณหภูมิอย่างน้อย 30°C และความชื้นไม่เกิน 30%RH',
  temperature_above_35: 'อุณหภูมิสูงกว่า 35°C',
  particle_above_50: 'อนุภาคโดยประมาณสูงกว่า 50 µg/m³',
  humidity_below_50: 'ความชื้นต่ำกว่า 50%RH',
  recovery_confirmation_pending: 'กำลังยืนยันค่าปกติก่อนลดระดับ',
  baseline_calibrating: 'กำลังเรียนค่าเริ่มต้นของเซนเซอร์',
  smoke_sensor_low_stuck: 'ค่าอนุภาค 0 ต่อเนื่อง',
  smoke_low_stable: 'ค่าอนุภาคต่ำคงที่',
  sensor_fault: 'เซนเซอร์รายงานข้อขัดข้อง',
  sensor_data_incomplete: 'ข้อมูลจากเซนเซอร์ไม่ครบ',
  sht31_missing: 'ไม่พบข้อมูลอุณหภูมิหรือความชื้น',
  smoke_weak: 'เริ่มพบอนุภาคควัน',
  smoke_strong: 'พบอนุภาคควันชัดเจน',
  smoke_critical: 'อนุภาคควันสูงผิดปกติ',
  smoke_rising_trend: 'อนุภาคควันเพิ่มขึ้นต่อเนื่อง',
  heat_weak: 'อุณหภูมิสูงกว่าปกติ',
  heat_strong: 'อุณหภูมิสูง',
  heat_critical: 'อุณหภูมิสูงผิดปกติ',
  temperature_fast_rise: 'อุณหภูมิเพิ่มเร็ว',
  humidity_dry: 'ความชื้นต่ำ',
  humidity_very_dry: 'อากาศแห้งมาก',
  humidity_critical_drop: 'ความชื้นลดลงแรง',
  humidity_fast_drop: 'ความชื้นลดเร็ว',
  weather_drift: 'สภาพอากาศเปลี่ยนแปลงต่อเนื่อง',
  drying_condition: 'สภาพอากาศแห้งลงต่อเนื่อง',
  fire_danger_high: 'สภาพอากาศเสี่ยงต่อการเกิดไฟสูง',
  fire_danger_very_high: 'สภาพอากาศเสี่ยงต่อการเกิดไฟสูงมาก',
  fog_humidity_penalty: 'ความชื้นสูง อาจมีหมอกหรือไอน้ำรบกวน',
  fog_humidity_minor_penalty: 'ความชื้นสูง อาจรบกวนค่าควันบางส่วน'
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

function reasonLines(reasons = []) {
  const uniqueReasons = [...new Set(reasons.filter(Boolean))].slice(0, 4);
  if (!uniqueReasons.length) return ['• ระบบตรวจพบค่าผิดปกติตามเกณฑ์'];
  return uniqueReasons.map((reason) => `• ${escapeHtml(REASON_LABELS[reason] || reason)}`);
}

function readingFrom(alert, reading) {
  return reading || alert?.last_reading || {};
}

function buildTelegramMessage(event, alert, reading, options = {}) {
  const config = { ...telegramConfig(), ...options };
  const current = readingFrom(alert, reading);
  const rawLevel = event === 'resolved' ? 'NORMAL' : alert?.level || current.state || current.node_state || current.server_state;
  const level = rawLevel === 'CRITICAL' ? 'WARNING' : rawLevel;
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
  const reasons = reasonLines(current.risk_reasons?.length
    ? current.risk_reasons
    : current.server_reasons || alert?.reasons || ['node_reported']);
  const particleValue = finiteNumber(current.particle_ug_m3);
  const legacySmokeRaw = finiteNumber(current.smoke_raw);
  const particleText = particleValue !== undefined
    ? formatValue(particleValue, ' µg/m³', 1)
    : legacySmokeRaw !== undefined
      ? `${formatValue(legacySmokeRaw, ' raw', 0)} (ข้อมูลรุ่นเก่า)`
      : 'ไม่มีข้อมูล';

  return [
    `${detail.icon} <b>${heading}: ${escapeHtml(detail.label)}</b>`,
    '',
    `<b>จุดตรวจ:</b> ${nodeId}`,
    `<b>ระดับระบบ:</b> ${escapeHtml(level)} (${escapeHtml(detail.label)})`,
    '',
    '<b>สาเหตุ:</b>',
    ...reasons,
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
  REASON_LABELS,
  buildTelegramMessage,
  escapeHtml,
  isTelegramConfigured,
  notifyTelegram,
  sendTelegramMessage,
  telegramConfig
};
