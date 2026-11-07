import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadEnergySeed, parseSeed, toInstant, SOLAR_ENERGY_PATH, MOTOR_ENERGY_PATH } from '../lib/history.js'

const NOW = Date.parse('2026-11-07T10:00:00Z')
const MIDNIGHT = Date.parse('2026-11-07T00:00:00Z')

const response = (rows) => ({
  context: 'vessels.self',
  range: {},
  values: [{ path: SOLAR_ENERGY_PATH, method: 'last' }, { path: MOTOR_ENERGY_PATH, method: 'last' }],
  data: rows
})

test('seed uses the last values from today', async () => {
  /** @type {any} */
  let query
  const api = { getValues: async (q) => { query = q; return response([['2026-11-07T08:00:00Z', 1000, 400], ['2026-11-07T09:00:00Z', 2000, null]]) } }
  const seed = await loadEnergySeed(async () => api, NOW, 0)
  assert.deepEqual(seed, { solarJ: 2000, motorJ: 400 })
  assert.equal(query.from.toString(), '2026-11-07T00:00:00.000Z')
  assert.deepEqual(query.pathSpecs.map((p) => p.aggregate), ['last', 'last'])
})

test('seed ignores values from before local midnight', () => {
  assert.deepEqual(parseSeed(response([['2026-11-06T23:59:00Z', 5000, 5000]]), MIDNIGHT), {})
})

test('seed is empty on null, throw, missing or odd API', async () => {
  assert.deepEqual(await loadEnergySeed(async () => ({ getValues: async () => null }), NOW), {})
  assert.deepEqual(await loadEnergySeed(async () => ({ getValues: async () => { throw new Error('no') } }), NOW), {})
  assert.deepEqual(await loadEnergySeed(async () => { throw new Error('no provider') }, NOW), {})
  assert.deepEqual(await loadEnergySeed(undefined, NOW), {})
  assert.deepEqual(await loadEnergySeed(async () => ({}), NOW), {})
  assert.deepEqual(parseSeed({ values: [], data: [[NOW, 1]] }, MIDNIGHT), {})
})

test('toInstant gives an instant-like object', () => {
  const i = toInstant(NOW)
  assert.equal(String(i), '2026-11-07T10:00:00.000Z')
  assert.equal(i.epochMilliseconds, NOW)
})
