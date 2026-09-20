// จัดการวงจรชีวิต Alert ตั้งแต่เริ่มเหตุการณ์ ยกระดับ จนกลับสู่ปกติ
const Alert = require('../models/Alert');
const { notifyTelegram } = require('./telegramService');
const { normalizeNodeRisk } = require('./nodeRisk');

const ALERT_LEVELS = ['WATCH', 'WARNING', 'SENSOR_FAULT'];
const SEVERITY = {
  NORMAL: 0,
  WATCH: 1,
  SENSOR_FAULT: 2,
  WARNING: 3
};

// ตรวจว่าสถานะนี้ต้องเปิดหรืออัปเดต Alert หรือไม่
function isAlertLevel(state) {
  return ALERT_LEVELS.includes(state);
}

// คืนลำดับความรุนแรงเพื่อใช้เปรียบเทียบระดับ Alert
function severityOf(level) {
  return SEVERITY[level] || 0;
}

// แจ้ง Telegram เฉพาะเมื่อระดับใหม่สูงกว่าระดับที่เคยแจ้งไปแล้ว
function shouldNotifyLevel(level, notifiedLevel) {
  return severityOf(level) > severityOf(notifiedLevel);
}

// บันทึกผลส่ง Telegram ลง Alert เพื่อป้องกันการส่งระดับเดิมซ้ำ
async function saveTelegramResult(alert, level, notification, now) {
  if (!alert || !notification) return;

  if (notification.status === 'sent') {
    alert.telegram_notified_level = level;
    alert.telegram_notified_at = now;
    alert.telegram_last_error = undefined;
  } else if (notification.status === 'failed') {
    alert.telegram_last_error = notification.reason;
  }

  if (notification.status === 'sent' || notification.status === 'failed') {
    await alert.save();
  }
}

// สร้างข้อความสั้นที่เก็บอยู่ใน Alert document
function buildMessage(nodeId, level) {
  return `${nodeId} reported ${level}`;
}

// คัดลอกเฉพาะค่าที่จำเป็นจาก Reading ไปเก็บเป็น snapshot ใน Alert
function buildLastReading(reading) {
  if (!reading) return undefined;

  return {
    reading_id: reading._id,
    seq: reading.seq,
    timestamp: reading.timestamp,
    state: reading.state,
    air_temp: reading.air_temp,
    humidity: reading.humidity,
    particle_adc: reading.particle_adc,
    sensor_health: reading.sensor_health,
    rssi: reading.rssi,
    snr: reading.snr
  };
}

// เปิด อัปเดต หรือปิด Alert ตามสถานะของ Reading ล่าสุด
async function processAlertForReading(reading) {
  if (!reading || !reading.node_id) {
    return { action: 'ignored' };
  }

  reading = normalizeNodeRisk(reading);

  const now = reading.timestamp || new Date();
  const nodeId = reading.node_id;
  const state = reading.state;

  if (state === 'NORMAL') {
    const closingAlert = await Alert.findOne({ node_id: nodeId, active: true })
      .sort({ started_at: -1 });
    const closed = await Alert.updateMany(
      { node_id: nodeId, active: true },
      { $set: { active: false, ended_at: now } }
    );
    const count = closed.modifiedCount || 0;
    const closingData = closingAlert?.toObject ? closingAlert.toObject() : closingAlert;
    const notification = count && closingData?.telegram_notified_level
      ? await notifyTelegram('resolved', { ...closingData, ended_at: now }, reading)
      : { status: 'skipped', reason: closingData ? 'start_not_notified' : 'no_active_alert' };
    if (notification.status === 'sent' && closingData?._id) {
      await Alert.updateOne(
        { _id: closingData._id },
        { $set: { telegram_resolved_notified_at: now }, $unset: { telegram_last_error: '' } }
      );
    }
    return { action: 'closed', count, notification: notification.status };
  }

  if (!isAlertLevel(state)) {
    return { action: 'ignored' };
  }

  const lastReading = buildLastReading(reading);
  const activeAlert = await Alert.findOne({ node_id: nodeId, active: true }).sort({ started_at: -1 });

  if (!activeAlert) {
    try {
      const alertData = {
        node_id: nodeId,
        level: state,
        started_at: now,
        active: true,
        max_state: state,
        message: buildMessage(nodeId, state),
        last_reading: lastReading
      };
      const alert = await Alert.create(alertData);

      const notification = await notifyTelegram('created', alert, reading);
      await saveTelegramResult(alert, state, notification, now);
      return { action: 'created', alert_id: alert._id, notification: notification.status };
    } catch (error) {
      if (error?.code === 11000) return processAlertForReading(reading);
      throw error;
    }
  }

  const nextLevel = severityOf(state) > severityOf(activeAlert.level) ? state : activeAlert.level;
  activeAlert.level = nextLevel;
  activeAlert.max_state =
    severityOf(state) > severityOf(activeAlert.max_state) ? state : activeAlert.max_state || nextLevel;
  activeAlert.message = buildMessage(nodeId, nextLevel);
  activeAlert.last_reading = lastReading;
  await activeAlert.save();

  const needsNotification = shouldNotifyLevel(nextLevel, activeAlert.telegram_notified_level);
  const notification = needsNotification
    ? await notifyTelegram(activeAlert.telegram_notified_level ? 'escalated' : 'created', activeAlert, reading)
    : { status: 'skipped', reason: 'level_unchanged' };
  await saveTelegramResult(activeAlert, nextLevel, notification, now);

  return { action: 'updated', alert_id: activeAlert._id, notification: notification.status };
}

module.exports = {
  ALERT_LEVELS,
  processAlertForReading,
  severityOf,
  shouldNotifyLevel
};
