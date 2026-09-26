import test from 'node:test'
import assert from 'node:assert/strict'
import { selectLiveOverview, assessLiveSafety } from '../src/liveOverview.ts'

const nodes = [
  { node_id: 'NODE01', online: false, state: 'WARNING' },
  { node_id: 'NODE02', online: true, state: 'NORMAL' },
  { node_id: 'NODE03', online: false, state: 'NORMAL' },
]
const health = { ok: true, gateway: { connected: true } }

test('one online node among three is the only map/selector node and reading target', () => {
  const { liveNodes, effectiveNodeId } = selectLiveOverview(nodes, 'NODE01')
  assert.deepEqual(liveNodes.map((node) => node.node_id), ['NODE02'])
  assert.equal(effectiveNodeId, 'NODE02')
  assert.equal(nodes.length, 3) // The full history inventory is not mutated.
})

test('offline nodes and inactive alerts do not block live assessment', () => {
  assert.deepEqual(assessLiveSafety(nodes, health, false), {
    highestState: 'NORMAL', canAssessSafety: true,
  })
})

test('live warning decisions come only from online nodes', () => {
  assert.equal(assessLiveSafety([
    { node_id: 'NODE02', online: true, state: 'WARNING' },
  ], health, false).highestState, 'WARNING')
})

test('an online sensor fault is shown instead of an all-clear', () => {
  assert.equal(assessLiveSafety([
    { node_id: 'NODE02', online: true, state: 'SENSOR_FAULT' },
  ], health, false).highestState, 'SENSOR_FAULT')
})

test('losing all nodes clears selection and cannot produce an all-clear', () => {
  const offline = nodes.map((node) => ({ ...node, online: false }))
  assert.deepEqual(selectLiveOverview(offline, 'NODE02'), { liveNodes: [], effectiveNodeId: undefined })
  assert.equal(assessLiveSafety(offline, health, false).canAssessSafety, false)
  assert.equal(selectLiveOverview(nodes, 'NODE02').effectiveNodeId, 'NODE02')
})

test('gateway loss or backend failure still prevents assessment', () => {
  assert.equal(assessLiveSafety(nodes, { ok: true, gateway: { connected: false } }, false).canAssessSafety, false)
  assert.equal(assessLiveSafety(nodes, health, true).canAssessSafety, false)
  assert.equal(assessLiveSafety(nodes, { ...health, ok: false }, false).canAssessSafety, false)
  assert.equal(assessLiveSafety(nodes, undefined, false).canAssessSafety, false)
})
