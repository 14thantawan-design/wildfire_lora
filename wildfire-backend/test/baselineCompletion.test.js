const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBaselineProgressUpdate } = require('../src/services/commandQueue');
const { buildBaselineRecalibrationSnapshot } = require('../src/routes/nodes');

const started = new Date('2026-09-11T07:59:00Z');
const finished = new Date('2026-09-11T08:15:51Z');
const ready = { node_id: 'NODE02', node_state: 'NORMAL', sensor_health: 'OK' };

test('CAL then OK closes a sent command despite a missing radio ACK', () => {
  const command = { status: 'sent', baseline_started_at: started };
  const update = buildBaselineProgressUpdate(command, ready, finished);
  assert.deepEqual(update, { $set: {
    completed_at: finished, status: 'acknowledged', result_reason: 'baseline_completion_observed'
  } });
  assert.equal(buildBaselineRecalibrationSnapshot(ready, { ...command, ...update.$set }).phase, 'completed');
  assert.equal(update.$set.acknowledged_at, undefined);
});

test('legacy sent plus completed command renders completed and repairs without changing finish time', () => {
  const command = { status: 'sent', baseline_started_at: started, completed_at: finished };
  assert.equal(buildBaselineRecalibrationSnapshot(ready, command).phase, 'completed');
  assert.deepEqual(buildBaselineProgressUpdate(command, ready, new Date()), { $set: {
    status: 'acknowledged', result_reason: 'baseline_completion_observed'
  } });
});

test('a normal reading alone cannot confirm a new recalibration command', () => {
  assert.equal(buildBaselineProgressUpdate({ status: 'sent' }, ready, finished), null);
  assert.equal(buildBaselineRecalibrationSnapshot(ready, { status: 'sent' }).phase, 'sent');
});

test('incomplete 11/12 warmup and sensor faults cannot close a command', () => {
  const command = { status: 'sent', baseline_started_at: started };
  const learning = { ...ready, baseline_warmup_count: 11, baseline_warmup_target: 12 };
  assert.equal(buildBaselineProgressUpdate(command, learning, finished), null);
  assert.equal(buildBaselineRecalibrationSnapshot(learning, command).phase, 'calibrating');
  assert.equal(buildBaselineProgressUpdate(command, { ...ready, sensor_health: 'FAULT' }, finished), null);
  const complete = { ...learning, baseline_warmup_count: 12 };
  assert.equal(buildBaselineProgressUpdate(command, complete, finished).$set.status, 'acknowledged');
});
