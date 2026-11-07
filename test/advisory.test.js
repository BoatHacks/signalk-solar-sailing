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
