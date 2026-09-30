import test from 'node:test'
import assert from 'node:assert/strict'
import { toThaiDateTimeInput, thaiDateTimeInputToIso } from '../src/thaiTime.ts'

test('reading time crossing midnight displays and saves in Bangkok time', () => {
  const input = toThaiDateTimeInput('2026-09-29T17:56:51.977Z')
  assert.equal(input, '2026-09-30T00:56:51')
  assert.equal(thaiDateTimeInputToIso(input), '2026-09-29T17:56:51.000Z')
})
