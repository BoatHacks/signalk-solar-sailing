import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Engine } from '../lib/engine.js'
import { resolveConfig } from '../lib/config.js'
import { readSources } from '../lib/sources.js'
import { SpeedModel } from '../lib/speed.js'
import { loadCurtisLog } from './helpers/tree.js'
import { replay } from './helpers/replay.js'

const T0 = Date.parse('2026-11-15T09:00:00Z')
const KIEL = { lat: 54.3233, lon: 10.1228, time: T0, stale: false }
const C = 2.5 / Math.pow(500, 1 / 3)
const cfg = (o = {}) => resolveConfig({ smoothingSeconds: 0, ...o }).config
const POWERS = [100, 150, 220, 330, 500, 750, 1100, 1600]

/**
 * @param {number} now
 * @param {{ motor?: number, stw?: number, navState?: string, course?: any, sog?: number, cog?: number }} o
 * @returns {import('../lib/types.js').Readings}
 */
function readings (now, o = {}) {
  return {
    solar: [{ id: '278', path: 'electrical.solar.278', watts: 600, via: 'panelPower', time: now, stale: false }],
    solarFallback: false,
    motor: o.motor === undefined ? undefined : { id: '99', path: 'm', watts: o.motor, inDrive: o.motor > 15, direction: 1, temperatures: {}, time: now, stale: false },
    dcSystem: { path: 'dc', watts: 100 + (o.motor || 0), time: now, stale: false },
    timezoneOffsetMin: 60,
    position: { ...KIEL, time: now },
    stw: o.stw === undefined ? undefined : { mps: o.stw, time: now, stale: false },
    ground: o.sog === undefined ? undefined : { sog: o.sog, cog: o.cog || 0, time: now, stale: false },
    navState: o.navState,
    course: o.course
  }
}

/**
 * Motor through the power steps, 60 s each, at 1 s ticks.
 * @param {Engine} e
 * @param {Partial<Parameters<typeof readings>[1]>} [extra]
 */
function learn (e, extra = {}, t0 = T0) {
  let t = t0
  for (const w of POWERS) {
    for (let s = 0; s < 60; s++, t += 1000) e.update(readings(t, { motor: w, stw: C * Math.pow(w, 1 / 3), ...extra }), t)
  }
  return t
}

test('learns while motoring, then range and ETAs show in idle too', () => {
  const e = new Engine(cfg())
  let t = learn(e)
  assert.ok(e.speed.ready)
  // Motor off: after idleAfterSeconds the engine is idle, range still computed.
  const course = { nextM: 40000, routeM: 80000, time: 0, stale: false }
  /** @type {any} */
  let s
  for (let i = 0; i < 40; i++, t += 1000) s = e.update(readings(t, { motor: 0, course: { ...course, time: t } }), t)
  assert.equal(s.mode, 'idle')
  assert.equal(s.rangeBasis, 'budget')
  assert.ok(Math.abs(/** @type {number} */ (s.speedAtBudget) - C * Math.pow(500, 1 / 3)) < 0.05, String(s.speedAtBudget))
  assert.ok(/** @type {number} */ (s.rangeUntilSunsetM) > 0)
  assert.ok(s.waypoint && s.waypoint.eta !== undefined && s.waypoint.requiredPowerW !== undefined)
  assert.ok(s.destination && s.destination.distanceM === 80000)
})

test('no learning in idle mode', () => {
  const e = new Engine(cfg())
  let t = T0
  // Idle: STW present (drifting, towed), motor below the idle threshold.
  for (let i = 0; i < 600; i++, t += 1000) e.update(readings(t, { motor: 10, stw: 1.5 }), t)
  assert.equal(e.speed.samples.length, 0)
})

test('no learning while sailing; an absent state is accepted', () => {
  const sailing = new Engine(cfg())
  learn(sailing, { navState: 'sailing' })
  assert.equal(sailing.speed.samples.length, 0)
  const motoring = new Engine(cfg())
  learn(motoring, { navState: 'motoring' })
  assert.ok(motoring.speed.ready)
})

test('without STW, course or model: the snapshot is plan 10\'s', () => {
  const e = new Engine(cfg())
  const s = e.update(readings(T0, { motor: 500, course: { nextM: 18000, time: T0, stale: false } }), T0)
  for (const k of ['stw', 'speedAtBudget', 'rangeUntilSunsetM', 'rangeBasis', 'waypoint', 'destination']) {
    assert.equal(k in s, false, k)
  }
})

test('STW factor scales the shown STW and the learned speed', () => {
  const plain = new Engine(cfg())
  learn(plain)
  const scaled = new Engine(cfg({ stwFactor: 1.1 }))
  const t = learn(scaled)
  const a = plain.update(readings(t, { motor: 500, stw: 2 }), t)
  const b = scaled.update(readings(t, { motor: 500, stw: 2 }), t)
  assert.ok(Math.abs(/** @type {number} */ (b.stw) - 2.2) < 1e-9)
  assert.equal(a.stw, 2)
  assert.ok(Math.abs(/** @type {number} */ (b.speedAtBudget) / /** @type {number} */ (a.speedAtBudget) - 1.1) < 1e-6)
})

test('SOG/STW ratios collected while motoring with fresh SOG and COG', () => {
  const e = new Engine(cfg())
  let t = T0
  for (const cog of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    for (let i = 0; i < 60; i++, t += 1000) e.update(readings(t, { motor: 500, stw: 1.8, sog: 2, cog }), t)
  }
  const s = e.speed.ratios.suggestion()
  assert.ok(s)
  assert.ok(Math.abs(s.factor - 2 / 1.8) < 1e-9)
})

test('configured fallback c gives a range before anything is learned', () => {
  const e = new Engine(cfg({ speedC: C }))
  const s = e.update(readings(T0, {}), T0)
  assert.ok(Math.abs(/** @type {number} */ (s.speedAtBudget) - 2.5) < 1e-9, 'budget 600 − 100 house = 500 W')
  assert.equal(e.speed.ready, false)
})

test('an injected speed model is used', () => {
  const speed = new SpeedModel({ fallbackC: C })
  const e = new Engine(cfg(), { speed })
  assert.equal(e.speed, speed)
})

test('Curtis replay (no STW): range fields stay unknown, no samples', () => {
  const config = resolveConfig({ propulsionPath: 'propulsion.99' }).config
  const e = new Engine(config)
  replay(loadCurtisLog().events, 1000, (tree, now) => {
    const s = e.update(readSources(tree, config, now), now)
    assert.equal(s.speedAtBudget, undefined)
    assert.equal(s.waypoint, undefined)
  }, { 'electrical.solar.278.panelPower': 150 })
  assert.equal(e.speed.samples.length, 0)
})
