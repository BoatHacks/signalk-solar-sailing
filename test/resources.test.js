import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStatus, forecastCurve, resourceMethods } from '../lib/resources.js'

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

test('forecast curve: until sunset plus one slot, average W, age', () => {
  const t0 = Date.parse('2026-11-15T10:15:00Z')
  const hours = Array.from({ length: 24 }, (_, i) => ({ t: t0 + i * 3600000, solarWh: 100 + i, houseWh: 30 }))
  const f = { time: t0, stale: false, hours, status: 'stable' }
  const snapshot = { t: t0 + 600000, sunset: t0 + 5.5 * 3600000 }
  const c = forecastCurve(/** @type {any} */ (f), /** @type {any} */ (snapshot))
  assert.ok(c)
  assert.equal(c.hours.length, 7, 'slots starting before sunset plus one')
  assert.deepEqual(c.hours[0], { t: '2026-11-15T10:15:00.000Z', solarW: 100, houseW: 30 })
  assert.equal(c.age, 600)
  assert.equal(c.status, 'stable')
  const after = forecastCurve(/** @type {any} */ (f), /** @type {any} */ ({ t: t0 + 6 * 3600000, sunset: t0 + 5.5 * 3600000 }))
  assert.equal(after?.hours.length, 24, 'after sunset: the whole forecast')
  assert.equal(forecastCurve(undefined, /** @type {any} */ (snapshot)), null)
})
