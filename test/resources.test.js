import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStatus, resourceMethods } from '../lib/resources.js'

const T = Date.parse('2026-11-07T10:00:00Z')

test('status returns the last snapshot and breakdown; writes reject', async () => {
  const snapshot = { t: T, matchState: 'matched' }
  const readings = {
    solar: [{ id: '278', path: 'electrical.solar.278', watts: 300, via: 'panelPower', time: T, stale: false }],
    solarFallback: false,
    motor: { id: '99', path: 'electrical.motordrive.99', watts: 200, inDrive: true, temperatures: {}, time: T, stale: false },
    dcSystem: { path: 'electrical.venus.dcPower', watts: 250, time: T, stale: false }
  }
  const m = resourceMethods(() => buildStatus(/** @type {any} */ (snapshot), /** @type {any} */ (readings), { n: 3, samples: 0, ready: false }))
  const status = await m.getResource('status')
  assert.equal(status.snapshot, snapshot)
  assert.equal(status.sources.solar[0].timestamp, '2026-11-07T10:00:00.000Z')
  assert.equal(status.sources.battery, null)
  assert.ok((await m.listResources({})).status)
  await assert.rejects(m.getResource('other'))
  await assert.rejects(m.setResource())
  await assert.rejects(m.deleteResource())
})

test('status before the first tick says unavailable', async () => {
  const m = resourceMethods(() => buildStatus(undefined, undefined, { n: 3, samples: 0, ready: false }))
  assert.deepEqual(await m.getResource('status'), { available: false })
})
