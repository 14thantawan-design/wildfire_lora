// บันทึกแพ็กเก็ตเซนเซอร์เป็น Reading อัปเดต Node และส่งต่อให้ระบบ Alert
const NodeModel = require('../../models/Node');
const Reading = require('../../models/Reading');
const { processAlertForReading } = require('../alertService');
const { riskFromPacket } = require('../nodeRisk');
const { validateSensorPacket } = require('./packetValidation');
const {
  extractRssi,
  extractSnr,
  invalidPacket,
  isOutOfOrderPacket,
  packetNumber,
  readingIdentity,
  setIfDefined,
  toNumber
} = require('./packetHelpers');

// รับแพ็กเก็ตที่ตรวจรูปแบบแล้วและบันทึกทุกส่วนที่เกี่ยวข้องใน MongoDB
async function handleSensorPacket(packet, meta = {}) {
  const validationError = validateSensorPacket(packet);
  if (validationError) return invalidPacket(validationError);

  const nodeId = packet.id.trim();
  const now = new Date();
  const identity = readingIdentity(packet);
  const duplicate = await Reading.findOne(identity).lean();
  if (duplicate) {
    return { type: 'sensor', node_id: nodeId, reading_id: duplicate._id, duplicate: true };
  }

  const currentNode = await NodeModel.findOne({ node_id: nodeId })
    .select('session_id last_seq')
    .lean();
  if (isOutOfOrderPacket(currentNode, packet)) {
    return { type: 'sensor', node_id: nodeId, ignored: true, stale: true, seq: packet.q };
  }

  const rssi = extractRssi(packet, meta);
  const snr = extractSnr(packet, meta);
  const risk = riskFromPacket(packet);
  const airTemp = packetNumber(packet, 'at');
  const humidity = packetNumber(packet, 'h');
  const particleAdc = packetNumber(packet, 'adc');
  const sensorHealth = packet.sh.trim().toUpperCase();

  const readingData = {
    node_id: nodeId,
    session_id: identity.session_id,
    report_interval_sec: toNumber(packet.ri),
    seq: toNumber(packet.q),
    timestamp: now,
    ...risk,
    air_temp: airTemp,
    humidity,
    particle_adc: particleAdc,
    sensor_health: sensorHealth,
    rssi,
    snr
  };

  const reading = await createReadingOrReturnDuplicate(readingData, identity, nodeId);
  if (reading.duplicateResult) return reading.duplicateResult;

  const nodeSet = {
    ...risk,
    air_temp: airTemp,
    humidity,
    particle_adc: particleAdc,
    sensor_health: sensorHealth,
    last_seen: now,
    session_id: identity.session_id,
    last_seq: toNumber(packet.q),
    report_interval_sec: toNumber(packet.ri)
  };
  setIfDefined(nodeSet, 'rssi', rssi);
  setIfDefined(nodeSet, 'snr', snr);

  await NodeModel.findOneAndUpdate(
    { node_id: nodeId },
    { $set: nodeSet, $setOnInsert: { node_id: nodeId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const alertResult = await processAlertForReading(reading.document);
  return {
    type: 'sensor',
    node_id: nodeId,
    reading_id: reading.document._id,
    risk,
    alert: alertResult
  };
}

// ป้องกันการบันทึก Reading ซ้ำในกรณีมี request สองตัวเข้าพร้อมกัน
async function createReadingOrReturnDuplicate(readingData, identity, nodeId) {
  try {
    return { document: await Reading.create(readingData) };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await Reading.findOne(identity).lean();
    return {
      duplicateResult: {
        type: 'sensor',
        node_id: nodeId,
        reading_id: existing?._id,
        duplicate: true
      }
    };
  }
}

module.exports = { handleSensorPacket };
