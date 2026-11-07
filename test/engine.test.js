import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Engine } from '../lib/engine.js'
import { resolveConfig } from '../lib/config.js'
import { readSources } from '../lib/sources.js'
import { PropellerModel } from '../lib/propeller.js'
import { loadCurtisLog } from './helpers/tree.js'
import { replay } from './helpers/replay.js'

const T = Date.parse('2026-11-07T10:00:00Z')
const cfg = (o = {}) => resolveConfig({ smoothingSeconds: 0, ...o }).config

/**
 * Readings by hand.
 * @param {{ solar?: number[], motor?: number, direction?: number, rpm?: number, gearRatio?: number,
 *   batteryW?: number, soc?: number, dc?: number, dcStale?: boolean, motorStale?: boolean }} o
 */
function readings (o = {}) {
  const motor = o.motor === undefined
    ? undefined
    : {
        id: '99',
        path: 'electrical.motordrive.99',
        watts: o.motorStale ? undefined : o.motor,
        rpm: o.rpm,
        direction: o.direction,
        gearRatio: o.gearRatio,
        inDrive: !o.motorStale && o.motor > 15 && o.direction !== 0,
        temperatures: {},
        stale: Boolean(o.motorStale)
      }
  return {
    solar: (o.solar || []).map((w, i) => ({ id: String(i), path: `electrical.solar.${i}`, watts: w, via: 'panelPower', time: T, stale: false })),
    solarFallback: false,
    motor,
    battery: o.batteryW === undefined && o.soc === undefined ? undefined : { id: 'b', path: 'b', watts: o.batteryW, soc: o.soc, stale: false },
    dcSystem: o.dc === undefined ? undefined : { path: 'dc', watts: o.dc, stale: Boolean(o.dcStale) }
  }
}

test('house load: DC system minus motor first', () => {
  const s = new Engine(cfg()).update(readings({ solar: [600], motor: 300, dc: 380, batteryW: 0 }), T)
  assert.equal(s.houseSource, 'dcSystem')
  assert.equal(s.houseW, 80)
  assert.equal(s.budgetW, 520)
})

test('house load: DC system as is when it excludes the motor', () => {
  const s = new Engine(cfg({ dcSystemIncludesMotor: false })).update(readings({ solar: [600], motor: 300, dc: 80 }), T)
  assert.equal(s.houseW, 80)
})

test('house load: balance when DC system is stale, then config', () => {
  let s = new Engine(cfg()).update(readings({ solar: [600], motor: 300, dc: 380, dcStale: true, batteryW: 250 }), T)
  assert.deepEqual([s.houseSource, s.houseW], ['balance', 50])
  s = new Engine(cfg({ fallbackHouseLoadW: 40 })).update(readings({ solar: [600], motor: 300 }), T)
  assert.deepEqual([s.houseSource, s.houseW], ['config', 40])
})

test('house load is clamped at 0', () => {
  const s = new Engine(cfg()).update(readings({ solar: [600], motor: 300, dc: 250 }), T)
  assert.equal(s.houseW, 0)
})

test('stale DC system power falls through to the balance without a jump', () => {
  const e = new Engine(cfg({ smoothingSeconds: 30 }))
  for (let i = 0; i < 120; i++) e.update(readings({ solar: [600], motor: 300, direction: 1, dc: 380, batteryW: 220 }), T + i * 1000)
  const before = e.last.houseW
  const s = e.update(readings({ solar: [600], motor: 300, direction: 1, dc: 380, dcStale: true, batteryW: 0 }), T + 121000)
  assert.equal(s.houseSource, 'balance')
  assert.ok(Math.abs(s.houseW - before) < (300 - before) * 0.1, `${before} -> ${s.houseW}`)
})

test('SoC bias feeds the budget', () => {
  const s = new Engine(cfg()).update(readings({ solar: [600], motor: 0, dc: 100, soc: 0.4 }), T)
  assert.equal(s.socBiasW, -100)
  assert.equal(s.budgetW, 400)
})

test('budget clamped to [0, max]; no max means no upper clamp', () => {
  assert.equal(new Engine(cfg({ maxMotorPowerW: 300 })).update(readings({ solar: [600], motor: 0, dc: 0 }), T).budgetW, 300)
  assert.equal(new Engine(cfg()).update(readings({ solar: [6000], motor: 0, dc: 0 }), T).budgetW, 6000)
  assert.equal(new Engine(cfg()).update(readings({ solar: [50], motor: 0, dc: 200 }), T).budgetW, 0)
})

test('unknown solar gives unknown budget and state, never 0', () => {
  const s = new Engine(cfg()).update(readings({ motor: 300, direction: 1, dc: 380 }), T)
  assert.equal(s.solarW, undefined)
  assert.equal(s.budgetW, undefined)
  assert.equal(s.matchState, 'unknown')
})

test('smoothing: a 1 s cloud dip barely moves the budget; a 2 min one does', () => {
  const e = new Engine(cfg({ smoothingSeconds: 30 }))
  let t = T
  const step = (solar) => e.update(readings({ solar: [solar], motor: 300, direction: 1, dc: 300 }), (t += 1000))
  for (let i = 0; i < 120; i++) step(800)
  const dip = step(100).budgetW
  assert.ok(dip > 750, `1 s dip: ${dip}`)
  for (let i = 0; i < 120; i++) step(100)
  assert.ok(e.last.budgetW < 150, `2 min dip: ${e.last.budgetW}`)
})

test('match state while in drive; unknown out of drive', () => {
  const e = new Engine(cfg())
  assert.equal(e.update(readings({ solar: [600], motor: 580, direction: 1, dc: 580 }), T).matchState, 'matched')
  assert.equal(e.update(readings({ solar: [600], motor: 700, direction: 1, dc: 700 }), T + 1000).matchState, 'over')
  assert.equal(e.update(readings({ solar: [600], motor: 200, direction: 1, dc: 200 }), T + 2000).matchState, 'under')
  assert.equal(e.update(readings({ solar: [600], motor: 200, direction: 0, dc: 200 }), T + 3000).matchState, 'unknown')
})

test('alarm only after overBudgetDelaySeconds of over; resets on matched and on leaving drive', () => {
  const e = new Engine(cfg({ overBudgetDelaySeconds: 5 }))
  const over = (t) => e.update(readings({ solar: [300], motor: 800, direction: 1, dc: 800 }), T + t * 1000)
  for (let t = 0; t < 5; t++) assert.equal(over(t).alarm, false)
  assert.equal(over(5).alarm, true)
  assert.equal(e.update(readings({ solar: [300], motor: 300, direction: 1, dc: 300 }), T + 6000).alarm, false)
  for (let t = 7; t < 12; t++) over(t)
  assert.equal(over(12).alarm, true)
  assert.equal(e.update(readings({ solar: [300], motor: 800, direction: 0, dc: 800 }), T + 13000).alarm, false)
})

test('mode: active in drive, idle after idleAfterSeconds or stale motor', () => {
  const e = new Engine(cfg({ idleAfterSeconds: 30 }))
  assert.equal(e.update(readings({ solar: [300], motor: 0, direction: 0 }), T).mode, 'idle')
  assert.equal(e.update(readings({ solar: [300], motor: 200, direction: 1 }), T + 1000).mode, 'active')
  assert.equal(e.update(readings({ solar: [300], motor: 0, direction: 0 }), T + 20000).mode, 'active')
  assert.equal(e.update(readings({ solar: [300], motor: 0, direction: 0 }), T + 31000).mode, 'idle')
  e.update(readings({ solar: [300], motor: 200, direction: 1 }), T + 32000)
  assert.equal(e.update(readings({ solar: [300], motor: 200, motorStale: true }), T + 33000).mode, 'idle')
})

test('idle: propeller learning and smoothing pause, solar and energy stay current', () => {
  const propeller = new PropellerModel()
  const e = new Engine(cfg({ smoothingSeconds: 30 }), { propeller })
  for (let i = 0; i < 100; i++) e.update(readings({ solar: [500 + i], motor: 0, direction: 0, rpm: 0, dc: 0 }), T + i * 10000)
  assert.equal(propeller.samples.length, 0)
  assert.equal(e.last.budgetW, 599, 'raw budget while idle')
  assert.ok(e.last.solarEnergyJ > 0)
})

test('target RPM from the model, shaft RPM with a gear ratio', () => {
  const propeller = new PropellerModel({ fallbackK: 1e-5, fallbackN: 3 })
  const e = new Engine(cfg(), { propeller })
  const s = e.update(readings({ solar: [270], motor: 100, direction: 1, rpm: 300, gearRatio: 2, dc: 100 }), T)
  assert.ok(Math.abs(s.targetRpm - 300) < 1e-6)
  assert.ok(Math.abs(s.targetShaftRpm - 150) < 1e-6)
  const n = new Engine(cfg()).update(readings({ solar: [270], motor: 100, direction: 1, dc: 100 }), T)
  assert.equal(n.targetRpm, undefined)
})

test('energy seed adds to today', () => {
  const e = new Engine(cfg())
  e.seedEnergy({ solarJ: 1000, motorJ: 500 }, T)
  e.update(readings({ solar: [100], motor: 50, dc: 50 }), T)
  const s = e.update(readings({ solar: [100], motor: 50, dc: 50 }), T + 10000)
  assert.equal(s.solarEnergyJ, 2000)
  assert.equal(s.motorEnergyJ, 1000)
})

test('replay of the Curtis log: no throw, never matched while solar is unknown', () => {
  const config = resolveConfig({ propulsionPath: 'propulsion.99' }).config
  const e = new Engine(config)
  let active = 0
  replay(loadCurtisLog().events, 1000, (tree, now) => {
    const s = e.update(readSources(tree, config, now), now)
    assert.equal(s.solarW, undefined)
    assert.equal(s.matchState, 'unknown')
    if (s.mode === 'active') active++
  })
  assert.ok(active > 0)
})

test('replay with sun: match state appears while in drive', () => {
  const config = resolveConfig({ propulsionPath: 'propulsion.99' }).config
  const e = new Engine(config)
  const states = new Set()
  replay(loadCurtisLog().events, 1000, (tree, now) => {
    states.add(e.update(readSources(tree, config, now), now).matchState)
  }, { 'electrical.solar.278.panelPower': 150 })
  assert.ok(states.has('unknown'))
  assert.ok([...states].some((s) => s !== 'unknown'), [...states].join())
})
