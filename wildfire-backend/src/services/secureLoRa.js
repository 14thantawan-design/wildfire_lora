// FG1: AES-256-GCM using Node's crypto and ESP32 mbedTLS; not LoRaWAN.
const crypto = require('node:crypto');

const HEADER_BYTES = 21;
const TAG_BYTES = 16;
const MAX_FRAME_BYTES = 255;

function failure(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function nodeIdForSlot(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 10) {
    throw failure('เลขโหนดต้องเป็นจำนวนเต็ม 1–10');
  }
  return `NODE${String(slot).padStart(2, '0')}`;
}

function slotForNodeId(nodeId) {
  if (typeof nodeId !== 'string' || !/^NODE(0[1-9]|10)$/.test(nodeId)) {
    throw failure('รหัสโหนดต้องเป็น NODE01–NODE10');
  }
  return Number(nodeId.slice(4));
}

function hexBytes(value, length) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length * 2}}$`).test(value)) {
    throw failure('invalid credential encoding');
  }
  return Buffer.from(value, 'hex');
}

function registryKey() {
  const value = process.env.DEVICE_REGISTRY_KEY;
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw failure('ตั้งค่า DEVICE_REGISTRY_KEY ก่อนลงทะเบียนโหนด', 503);
  }
  return Buffer.from(value, 'hex');
}

function sealDeviceKey(key, nodeId, generation) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', registryKey(), iv);
  cipher.setAAD(Buffer.from(`${nodeId}|${generation}`));
  const encrypted = Buffer.concat([cipher.update(hexBytes(key, 32)), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64');
}

function openDeviceKey(value, nodeId, generation) {
  const bytes = Buffer.from(value || '', 'base64');
  if (bytes.length !== 60) throw failure('device credentials are unavailable', 503);
  const decipher = crypto.createDecipheriv('aes-256-gcm', registryKey(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${nodeId}|${generation}`));
  decipher.setAuthTag(bytes.subarray(44));
  try {
    return Buffer.concat([decipher.update(bytes.subarray(12, 44)), decipher.final()]).toString('hex');
  } catch {
    throw failure('device credentials could not be opened', 503);
  }
}

function provisionProof(key, nodeId, generation, challenge) {
  return crypto.createHmac('sha256', hexBytes(key, 32))
    .update(`FG1P|${nodeId}|${generation}|${challenge}`).digest('hex');
}

function validProof(actual, expected) {
  return typeof actual === 'string' && /^[0-9a-f]{64}$/.test(actual) &&
    crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function inspectFrame(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 340 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw failure('invalid LoRa frame');
  const frame = Buffer.from(encoded, 'base64');
  if (frame.toString('base64') !== encoded || frame.length <= HEADER_BYTES + TAG_BYTES ||
      frame.length > MAX_FRAME_BYTES || frame.subarray(0, 4).toString() !== 'FGU1') {
    throw failure('signed FG1 uplink is required', 401);
  }
  const slot = frame[4];
  const sequenceBig = frame.readBigUInt64BE(13);
  if (sequenceBig < 1n || sequenceBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw failure('invalid uplink sequence');
  }
  return {
    frame, nodeId: nodeIdForSlot(slot),
    generation: frame.subarray(5, 13).toString('hex'), sequence: Number(sequenceBig)
  };
}

function decryptUplink(encoded, key) {
  const info = inspectFrame(encoded);
  const iv = Buffer.concat([info.frame.subarray(0, 4), info.frame.subarray(13, 21)]);
  const decipher = crypto.createDecipheriv('aes-256-gcm', hexBytes(key, 32), iv);
  decipher.setAAD(info.frame.subarray(0, HEADER_BYTES));
  decipher.setAuthTag(info.frame.subarray(-TAG_BYTES));
  let packet;
  try {
    const plaintext = Buffer.concat([
      decipher.update(info.frame.subarray(HEADER_BYTES, -TAG_BYTES)), decipher.final()
    ]);
    packet = JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw failure('invalid node authentication', 401);
  }
  if (!packet || typeof packet !== 'object' || Array.isArray(packet) || packet.id !== info.nodeId) {
    throw failure('node identity does not match frame', 401);
  }
  return { ...info, packet };
}

function validatePacket(packet) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const measured = (value) => value === null || finite(value);
  if (packet.t === 's') {
    if (!['NORMAL', 'WATCH', 'WARNING', 'SENSOR_FAULT'].includes(packet.st) ||
        !Number.isInteger(packet.ri) || packet.ri < 1 || packet.ri > 86400 ||
        !measured(packet.at) || !measured(packet.h) || !measured(packet.adc)) {
      throw failure('invalid sensor packet');
    }
  } else if (packet.t === 'gps') {
    if (![0, 1].includes(packet.gf) || (packet.gf === 1 &&
        (!finite(packet.la) || Math.abs(packet.la) > 90 ||
         !finite(packet.ln) || Math.abs(packet.ln) > 180)) ||
        (packet.er !== undefined && (typeof packet.er !== 'string' || packet.er.length > 64))) {
      throw failure('invalid GPS packet');
    }
  } else if (packet.t === 'cmd_ack') {
    if (typeof packet.cid !== 'string' || !/^cmd_[a-z0-9]+_[0-9a-f]{8}$/.test(packet.cid) ||
        ![0, 1].includes(packet.ok) ||
        (packet.r !== undefined && (typeof packet.r !== 'string' || packet.r.length > 80))) {
      throw failure('invalid command acknowledgement');
    }
  } else throw failure('unsupported secure packet type');
  return packet;
}

module.exports = {
  decryptUplink, failure, hexBytes, inspectFrame, nodeIdForSlot, openDeviceKey,
  provisionProof, registryKey, sealDeviceKey, slotForNodeId, validProof, validatePacket
};
