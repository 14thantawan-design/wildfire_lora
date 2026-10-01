// Admin-only registration, USB proof, soft deletion, and TLS gateway key sync.
const crypto = require('node:crypto');
const express = require('express');
const NodeModel = require('../models/Node');
const Command = require('../models/Command');
const { requireGatewayKey, requireLocalAdmin } = require('../middleware/security');
const { markGatewayPacket } = require('../services/gatewayStatus');
const {
  failure, nodeIdForSlot, slotForNodeId, registryKey, sealDeviceKey,
  openDeviceKey, provisionProof, validProof
} = require('../services/secureLoRa');

const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/gateway', requireGatewayKey, async (req, res, next) => {
  try {
    registryKey();
    const nodes = await NodeModel.find({ registration_status: 'active' })
      .select('+credential_ciphertext +uplink_sequence');
    const devices = nodes.map((node) => ({
      node_id: node.node_id, slot: slotForNodeId(node.node_id),
      generation: node.credential_generation, last_sequence: node.uplink_sequence || 0,
      key: openDeviceKey(node.credential_ciphertext, node.node_id, node.credential_generation)
    }));
    markGatewayPacket('http');
    res.json({ ttl_ms: 30000, devices });
  } catch (error) { next(error); }
});

router.use(requireLocalAdmin);

router.get('/', async (req, res, next) => {
  try {
    const nodes = await NodeModel.find().sort({ node_id: 1 });
    res.json(nodes.map((node) => ({
      node_id: node.node_id, status: node.registration_status || 'legacy',
      generation: node.credential_generation, last_seen: node.last_seen,
      expires_at: node.provisioning_expires_at, archived_at: node.archived_at
    })));
  } catch (error) { next(error); }
});

async function cancelCommands(nodeId, generation) {
  const filter = { node_id: nodeId, credential_generation: generation || null,
    status: { $in: ['pending', 'sent'] } };
  await Command.updateMany(filter, { $set: {
    status: 'rejected', completed_at: new Date(), result_reason: 'credentials_revoked'
  } });
}

router.post('/', async (req, res, next) => {
  try {
    const nodeId = nodeIdForSlot(req.body?.slot);
    if (req.body?.replace !== undefined && typeof req.body.replace !== 'boolean') {
      throw failure('replace must be a boolean');
    }
    registryKey();
    const existing = await NodeModel.findOne({ node_id: nodeId });
    const now = new Date();
    const occupied = existing && existing.registration_status !== 'archived' &&
      !(existing.registration_status === 'pending' && existing.provisioning_expires_at <= now);
    if (occupied && req.body.replace !== true) {
      throw failure(`${nodeId} ถูกใช้งานอยู่แล้ว เลือกติดตั้งใหม่หากต้องการเปลี่ยนบอร์ด`, 409);
    }
    const generation = crypto.randomBytes(8).toString('hex');
    const key = crypto.randomBytes(32).toString('hex');
    const challenge = crypto.randomBytes(16).toString('hex');
    const expires = new Date(now.getTime() + 10 * 60 * 1000);
    const fields = {
      registration_status: 'pending', credential_generation: generation,
      credential_ciphertext: sealDeviceKey(key, nodeId, generation),
      provisioning_challenge: challenge, provisioning_expires_at: expires,
      uplink_sequence: 0, state: 'UNKNOWN', gps_fixed: false
    };
    if (existing) {
      const changed = await NodeModel.findOneAndUpdate(
        { _id: existing._id, updated_at: existing.updated_at,
          credential_generation: existing.credential_generation || null },
        { $set: fields, $unset: {
          archived_at: '', last_seen: '', air_temp: '', humidity: '', particle_adc: '',
          rssi: '', snr: '', lat: '', lng: '', location_source: '', location_updated_at: '', gps_error: ''
        } }, { new: true }
      );
      if (!changed) throw failure('โหนดมีการเปลี่ยนแปลง กรุณาโหลดรายการใหม่', 409);
      await cancelCommands(nodeId, existing.credential_generation);
    } else {
      await NodeModel.create({ node_id: nodeId, ...fields });
    }
    res.status(201).json({
      node_id: nodeId, generation, challenge, key, expires_at: expires,
      restored: Boolean(existing), protocol: 'FG1', model: 'lilygo-lora32-433'
    });
  } catch (error) {
    if (error.code === 11000) return next(failure('เลขโหนดนี้ถูกลงทะเบียนพร้อมกัน กรุณาโหลดใหม่', 409));
    next(error);
  }
});

router.post('/:node_id/activate', async (req, res, next) => {
  try {
    slotForNodeId(req.params.node_id);
    if (typeof req.body?.generation !== 'string' || !/^[0-9a-f]{16}$/.test(req.body.generation)) {
      throw failure('invalid credential generation');
    }
    const filter = {
      node_id: req.params.node_id, registration_status: 'pending',
      credential_generation: req.body.generation, provisioning_expires_at: { $gt: new Date() }
    };
    const node = await NodeModel.findOne(filter)
      .select('+credential_ciphertext +provisioning_challenge');
    if (!node) throw failure('การลงทะเบียนหมดอายุหรือถูกยกเลิก กรุณาลงทะเบียนใหม่', 409);
    const key = openDeviceKey(node.credential_ciphertext, node.node_id, node.credential_generation);
    const expected = provisionProof(key, node.node_id, node.credential_generation, node.provisioning_challenge);
    if (!validProof(req.body?.proof, expected)) throw failure('บอร์ดยืนยันการตั้งค่าไม่สำเร็จ', 401);
    const activated = await NodeModel.findOneAndUpdate(filter, {
      $set: { registration_status: 'active' },
      $unset: { provisioning_challenge: '', provisioning_expires_at: '' }
    }, { new: true });
    if (!activated) throw failure('การลงทะเบียนถูกเปลี่ยนแปลง กรุณาโหลดใหม่', 409);
    res.json({ node_id: node.node_id, status: 'active' });
  } catch (error) { next(error); }
});

router.delete('/:node_id', async (req, res, next) => {
  try {
    slotForNodeId(req.params.node_id);
    const node = await NodeModel.findOneAndUpdate({ node_id: req.params.node_id }, {
      $set: { registration_status: 'archived', archived_at: new Date() },
      $unset: { credential_ciphertext: '', credential_generation: '',
        provisioning_challenge: '', provisioning_expires_at: '' }
    });
    if (!node) throw failure('node not found', 404);
    await cancelCommands(node.node_id, node.credential_generation);
    res.json({ node_id: node.node_id, archived: true, history_preserved: true });
  } catch (error) { next(error); }
});

module.exports = router;
