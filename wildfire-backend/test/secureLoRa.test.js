const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decryptUplink, inspectFrame, nodeIdForSlot, openDeviceKey, provisionProof,
  sealDeviceKey, slotForNodeId, validProof
} = require('../src/services/secureLoRa');
const { buildNodeStatusList } = require('../src/routes/nodes');

// Independently generated with Node crypto, no application implementation imported.
// Also consumed by firmware_checks/fg1_vector to check Node <-> ESP32 interoperability.
const KEY = '00'.repeat(32);
const GENERATION = '0102030405060708';
const FRAME = 'RkdVMQEBAgMEBQYHCAAAAAAAAAABJDAr4zmL8EXLXhFBdM+NQh5n7H83ysJbKuckZFWdiFtL6ilarl3lGfpynmNTg6eP5mQv2zvy9m5FhDv/mRl65uiWS50zhvgltJGM1keYQ7g5FJ19Lw==';

test('fixed slots reject ambiguous or out-of-range identities', () => {
  assert.equal(nodeIdForSlot(1), 'NODE01');
  assert.equal(nodeIdForSlot(10), 'NODE10');
  assert.equal(slotForNodeId('NODE10'), 10);
  for (const value of [0, 11, 1.5, '1', null, {}, NaN]) assert.throws(() => nodeIdForSlot(value));
  for (const id of ['NODE1', 'NODE00', 'NODE11', '../NODE01', 'NODE01 ']) assert.throws(() => slotForNodeId(id));
});

test('FG1 matches independent AES-GCM fixture and rejects tampering in every byte', () => {
  const result = decryptUplink(FRAME, KEY);
  assert.equal(result.nodeId, 'NODE01');
  assert.equal(result.generation, GENERATION);
  assert.equal(result.sequence, 1);
  assert.deepEqual(result.packet, { t: 's', id: 'NODE01', ri: 300, st: 'NORMAL', at: 27, h: 70, adc: 0 });
  const bytes = Buffer.from(FRAME, 'base64');
  for (let index = 0; index < bytes.length; index++) {
    const changed = Buffer.from(bytes);
    changed[index] ^= 1;
    assert.throws(() => decryptUplink(changed.toString('base64'), KEY), `byte ${index}`);
  }
  assert.throws(() => decryptUplink(FRAME, '11'.repeat(32)), /authentication/);
  assert.throws(() => inspectFrame(FRAME + '\n'));
  assert.throws(() => inspectFrame(Buffer.alloc(256).toString('base64')));
  assert.throws(() => inspectFrame(JSON.stringify({ t: 's', id: 'NODE01' })));
  const reflected = Buffer.from(bytes);
  reflected.write('FGD1', 0);
  assert.throws(() => inspectFrame(reflected.toString('base64')));
});

test('node keys are sealed to node and generation; USB proof binds the challenge', () => {
  const previous = process.env.DEVICE_REGISTRY_KEY;
  process.env.DEVICE_REGISTRY_KEY = '22'.repeat(32);
  try {
    const sealed = sealDeviceKey(KEY, 'NODE01', GENERATION);
    assert.equal(openDeviceKey(sealed, 'NODE01', GENERATION), KEY);
    assert.throws(() => openDeviceKey(sealed, 'NODE02', GENERATION));
    assert.throws(() => openDeviceKey(sealed, 'NODE01', '03'.repeat(8)));
    const proof = provisionProof(KEY, 'NODE01', GENERATION, '04'.repeat(16));
    assert.equal(validProof(proof, proof), true);
    assert.equal(validProof('0', proof), false);
    assert.equal(validProof(proof, provisionProof(KEY, 'NODE01', GENERATION, '05'.repeat(16))), false);
    delete process.env.DEVICE_REGISTRY_KEY;
    assert.throws(() => sealDeviceKey(KEY, 'NODE01', GENERATION), { status: 503 });
  } finally {
    if (previous === undefined) delete process.env.DEVICE_REGISTRY_KEY;
    else process.env.DEVICE_REGISTRY_KEY = previous;
  }
});

test('archived and pending nodes are hidden, and a restored node is not online without fresh data', () => {
  const nodes = buildNodeStatusList([
    { node_id: 'NODE01', registration_status: 'archived', last_seen: new Date() },
    { node_id: 'NODE02', registration_status: 'pending', last_seen: new Date() },
    { node_id: 'NODE03', registration_status: 'active', state: 'UNKNOWN' },
    { node_id: 'NODE04', registration_status: 'legacy', last_seen: new Date() }
  ]);
  assert.deepEqual(nodes.map((node) => node.node_id), ['NODE03', 'NODE04']);
  assert.equal(nodes.every((node) => !node.online), true);
});

test('ingestion atomically consumes a sequence once and rejects archived credentials without writes', async () => {
  const NodeModel = require('../src/models/Node');
  const Reading = require('../src/models/Reading');
  const Alert = require('../src/models/Alert');
  const { handlePacket } = require('../src/services/packetHandler');
  const previousKey = process.env.DEVICE_REGISTRY_KEY;
  const original = {
    findOne: NodeModel.findOne, update: NodeModel.findOneAndUpdate,
    createReading: Reading.create, findAlert: Alert.findOne, updateAlert: Alert.updateMany
  };
  process.env.DEVICE_REGISTRY_KEY = '22'.repeat(32);
  const node = {
    node_id: 'NODE01', registration_status: 'active', credential_generation: GENERATION,
    uplink_sequence: 0, credential_ciphertext: sealDeviceKey(KEY, 'NODE01', GENERATION)
  };
  let readings = 0;
  NodeModel.findOne = (filter) => ({ select: async () =>
    node.registration_status === filter.registration_status &&
    node.credential_generation === filter.credential_generation ? { ...node } : null });
  NodeModel.findOneAndUpdate = async (filter, update) => {
    assert.equal(filter.registration_status, 'active');
    assert.equal(filter.credential_generation, GENERATION);
    if (node.registration_status !== 'active') return null;
    if (filter.uplink_sequence && !(node.uplink_sequence < filter.uplink_sequence.$lt)) return null;
    Object.assign(node, update.$set);
    return { ...node };
  };
  Reading.create = async (value) => { readings++; return { _id: 'dummy-reading', ...value }; };
  Alert.findOne = () => ({ sort: async () => null });
  Alert.updateMany = async () => ({ modifiedCount: 0 });
  try {
    const outcomes = await Promise.allSettled([
      handlePacket({ frame: FRAME, rssi: -60, snr: 8 }),
      handlePacket({ frame: FRAME, rssi: -60, snr: 8 })
    ]);
    assert.equal(outcomes.filter((value) => value.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find((value) => value.status === 'rejected').reason.status, 409);
    assert.equal(readings, 1);
    assert.equal(node.uplink_sequence, 1);
    node.registration_status = 'archived';
    await assert.rejects(handlePacket({ frame: FRAME }), { status: 401 });
    assert.equal(readings, 1);
  } finally {
    NodeModel.findOne = original.findOne;
    NodeModel.findOneAndUpdate = original.update;
    Reading.create = original.createReading;
    Alert.findOne = original.findAlert;
    Alert.updateMany = original.updateAlert;
    if (previousKey === undefined) delete process.env.DEVICE_REGISTRY_KEY;
    else process.env.DEVICE_REGISTRY_KEY = previousKey;
  }
});

test('soft delete revokes credentials without deleting node or history, restore reuses the document', async () => {
  const router = require('../src/routes/devices');
  const NodeModel = require('../src/models/Node');
  const Command = require('../src/models/Command');
  const original = { find: NodeModel.findOne, update: NodeModel.findOneAndUpdate, commands: Command.updateMany };
  const previousKey = process.env.DEVICE_REGISTRY_KEY;
  process.env.DEVICE_REGISTRY_KEY = '22'.repeat(32);
  const existing = { _id: 'same-logical-id', node_id: 'NODE01', registration_status: 'active',
    credential_generation: GENERATION, updated_at: new Date(0) };
  const updates = [];
  const commands = [];
  NodeModel.findOne = async () => existing;
  NodeModel.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
    return { ...existing };
  };
  Command.updateMany = async (filter, update) => { commands.push({ filter, update }); };
  const handler = (method, path) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])
    .route.stack.at(-1).handle;
  const response = { body: undefined, status() { return this; }, json(value) { this.body = value; return this; } };
  const fail = (error) => { throw error; };
  try {
    await handler('delete', '/:node_id')({ params: { node_id: 'NODE01' } }, response, fail);
    assert.equal(response.body.history_preserved, true);
    assert.equal(updates[0].update.$set.registration_status, 'archived');
    assert.ok(Object.hasOwn(updates[0].update.$unset, 'credential_ciphertext'));
    assert.equal(commands[0].filter.credential_generation, GENERATION);
    existing.registration_status = 'archived';
    existing.credential_generation = undefined;
    await handler('post', '/')({ body: { slot: 1 } }, response, fail);
    assert.equal(updates[1].filter._id, 'same-logical-id');
    assert.equal(updates[1].update.$set.registration_status, 'pending');
    assert.ok(Object.hasOwn(updates[1].update.$unset, 'last_seen'));
    assert.equal(response.body.node_id, 'NODE01');
    assert.notEqual(response.body.generation, GENERATION);
    assert.equal(response.body.restored, true);
  } finally {
    NodeModel.findOne = original.find;
    NodeModel.findOneAndUpdate = original.update;
    Command.updateMany = original.commands;
    if (previousKey === undefined) delete process.env.DEVICE_REGISTRY_KEY;
    else process.env.DEVICE_REGISTRY_KEY = previousKey;
  }
});
