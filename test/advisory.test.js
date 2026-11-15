import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAdvisoryOutput, snapshotValues, NOTIFICATION_PATH, PREFIX } from '../lib/outputs/advisory.js'

const T = Date.parse('2026-11-07T10:00:00Z')

function fakeApp () {
  const messages = []
  const metadata = []
  return {
    messages,
    metadata,
    handleMessage: (id, delta) => messages.push({ id, delta }),
    setDefaultMetadata: async (path, value) => { metadata.push({ path, value }); return true },
    error: () => {}
  }
}

/** @param {Partial<import('../lib/types.js').Snapshot>} o */
const snap = (o = {}) => ({
  t: T, mode: 'active', inDrive: true, solarW: 600, houseW: 50, houseSource: 'dcSystem', socBiasW: 0,
  budgetW: 550, motorW: 500, motorSmoothedW: 500, balanceW: 50, matchState: 'matched', targetRpm: 450,
  alarm: false, solarEnergyJ: 1000.4, motorEnergyJ: 500.6, ...o
})

const valuesOf = (m) => m.delta.updates[0].values || []

test('deltas carry only plugin.solarsailing.* paths in SI', () => {
  const app = fakeApp()
  const out = createAdvisoryOutput(app, 'p')
  out.update(snap(), T)
  const vals = valuesOf(app.messages[0])
  assert.ok(vals.every((v) => v.path.startsWith(PREFIX)))
  const byPath = Object.fromEntries(vals.map((v) => [v.path.slice(PREFIX.length), v.value]))
  assert.equal(byPath.targetRevolutions, 7.5)
  assert.equal(byPath.solarEnergyToday, 1000)
  assert.equal(byPath.targetShaftRevolutions, undefined, 'no gear ratio, no shaft path')
})

test('unknown numbers are published as null; shaft RPM only with a gear ratio', () => {
  const v = snapshotValues(snap({ budgetW: undefined, targetRpm: undefined, gearRatio: 2, targetShaftRpm: undefined }))
  assert.equal(v.budget, null)
  assert.equal(v.targetRevolutions, null)
  assert.equal(v.targetShaftRevolutions, null)
  assert.equal(snapshotValues(snap({ gearRatio: 2, targetShaftRpm: 225 })).targetShaftRevolutions, 3.75)
})

test('no delta when nothing changed for less than 5 s', () => {
  const app = fakeApp()
  const out = createAdvisoryOutput(app, 'p')
  out.update(snap(), T)
  out.update(snap(), T + 1000)
  out.update(snap(), T + 4000)
  assert.equal(app.messages.length, 1)
  out.update(snap(), T + 5000)
  assert.equal(app.messages.length, 2)
  out.update(snap({ motorW: 510 }), T + 6000)
  assert.equal(app.messages.length, 3)
})

test('notification sent once on raise and once on clear', () => {
  const app = fakeApp()
  const out = createAdvisoryOutput(app, 'p')
  const notes = () => app.messages.flatMap(valuesOf).filter((v) => v.path === NOTIFICATION_PATH)
  out.update(snap(), T)
  assert.equal(notes().length, 0)
  out.update(snap({ alarm: true, matchState: 'over' }), T + 1000)
  out.update(snap({ alarm: true, matchState: 'over' }), T + 2000)
  out.update(snap({ alarm: false }), T + 3000)
  out.update(snap({ alarm: false }), T + 4000)
  assert.deepEqual(notes().map((n) => n.value.state), ['warn', 'normal'])
})

test('stop clears a raised alarm and publishes matchState unknown', () => {
  const app = fakeApp()
  const out = createAdvisoryOutput(app, 'p')
  out.update(snap({ alarm: true }), T)
  out.stop()
  const last = app.messages.flatMap(valuesOf)
  assert.equal(last.find((v) => v.path === NOTIFICATION_PATH && v.value.state === 'normal') !== undefined, true)
  assert.equal(last[last.length - 1].value, 'unknown')
})

test('metadata: units and timeout via meta delta, displayUnits via setDefaultMetadata', async () => {
  const app = fakeApp()
  await createAdvisoryOutput(app, 'p').registerMeta()
  const meta = app.messages[0].delta.updates[0].meta
  assert.equal(meta.find((m) => m.path === PREFIX + 'budget').value.units, 'W')
  assert.equal(meta.find((m) => m.path === PREFIX + 'solarEnergyToday').value.units, 'J')
  assert.equal(meta.find((m) => m.path === PREFIX + 'targetRevolutions').value.units, 'Hz')
  assert.ok(meta.every((m) => m.value.timeout === 15))
  assert.ok(app.metadata.some((m) => m.path === PREFIX + 'solarEnergyToday' && m.value.displayUnits.targetUnit === 'Wh'))
  const noDefault = fakeApp()
  delete noDefault.setDefaultMetadata
  await createAdvisoryOutput(noDefault, 'p').registerMeta()
  assert.equal(noDefault.messages.length, 1)
})

test('forecast paths: null when unknown, ISO times to the minute', () => {
  let v = snapshotValues(/** @type {any} */ (snap({ forecastBiasW: 0 })))
  for (const k of ['dayBudget', 'dayBudgetBasis', 'sunsetTargetSoc', 'solarRemaining', 'houseRemaining', 'sunset', 'bestHoursStart', 'bestHoursEnd']) {
    assert.equal(v[k], null, k)
  }
  assert.equal(v.forecastBias, 0)
  v = snapshotValues(/** @type {any} */ (snap({
    forecastBiasW: -100,
    dayBudgetW: 321.26,
    dayBudgetBasis: 'target',
    sunsetTargetSoc: 0.227724,
    solarRemainingJ: 1234.5,
    houseRemainingJ: 99.4,
    sunset: Date.parse('2026-11-15T15:18:46.300Z'),
    bestHours: { start: Date.parse('2026-11-15T10:15:02Z'), end: Date.parse('2026-11-15T13:15:02Z') }
  })))
  assert.equal(v.dayBudget, 321.3)
  assert.equal(v.dayBudgetBasis, 'target')
  assert.equal(v.sunsetTargetSoc, 0.2277)
  assert.equal(v.solarRemaining, 1235)
  assert.equal(v.sunset, '2026-11-15T15:19:00.000Z')
  assert.equal(v.bestHoursStart, '2026-11-15T10:15:00.000Z')
  assert.equal(v.bestHoursEnd, '2026-11-15T13:15:00.000Z')
})

test('range paths: null when unknown, SI units, ISO ETAs', () => {
  let v = snapshotValues(/** @type {any} */ (snap()))
  for (const k of ['speedAtBudget', 'rangeUntilSunset', 'rangeBasis', 'waypointEta', 'waypointRequiredPower', 'destinationEta', 'destinationRequiredPower']) {
    assert.equal(v[k], null, k)
  }
  v = snapshotValues(/** @type {any} */ (snap({
    speedAtBudget: 2.4567,
    rangeUntilSunsetM: 35123.4,
    rangeBasis: 'dayBudget',
    waypoint: { distanceM: 9000, eta: Date.parse('2026-11-15T13:02:29Z'), afterSunset: false, requiredPowerW: 87.66 },
    destination: { distanceM: 60000, eta: Date.parse('2026-11-15T19:40:00Z'), afterSunset: true }
  })))
  assert.equal(v.speedAtBudget, 2.46)
  assert.equal(v.rangeUntilSunset, 35123)
  assert.equal(v.rangeBasis, 'dayBudget')
  assert.equal(v.waypointEta, '2026-11-15T13:02:00.000Z')
  assert.equal(v.waypointRequiredPower, 87.7)
  assert.equal(v.destinationEta, '2026-11-15T19:40:00.000Z')
  assert.equal(v.destinationRequiredPower, null)
})
