import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SpeedModel, StwRatios, M_DEFAULT } from '../lib/speed.js'

/**
 * Hold each power for 60 s at 1 s ticks.
 * @param {SpeedModel} m
 * @param {number[]} powers
 * @param {(w: number, i: number) => number} speed
 * @param {(w: number, i: number) => boolean} [ok]
 */
function cruise (m, powers, speed, ok = () => true, t0 = 0) {
  let t = t0
  let i = 0
  for (const w of powers) {
    m.window = []
    for (let s = 0; s < 60; s++, t += 1000, i++) m.observe(w, speed(w, i), ok(w, i), t)
  }
  return t
}

const spread = [100, 150, 220, 330, 500, 750, 1100, 1600]
const C = 2.5 / Math.pow(500, 1 / 3)

for (const mm of [1 / 3, 0.45]) {
  test(`recovers c and m = ${mm.toFixed(2)} within 5 %`, () => {
    const c = 2.5 / Math.pow(500, mm)
    const m = new SpeedModel()
    cruise(m, spread, (w) => c * Math.pow(w, mm))
    assert.ok(m.ready)
    const p = m.params()
    assert.ok(p && p.learned)
    assert.ok(Math.abs(p.m - mm) / mm < 0.05, `m=${p.m}`)
    assert.ok(Math.abs(p.c - c) / c < 0.05, `c=${p.c}`)
    assert.deepEqual([p.minPowerW, p.maxPowerW], [100, 1600])
    assert.ok(Math.abs(/** @type {number} */ (m.speedAt(400)) - c * Math.pow(400, mm)) < 0.01)
  })
}

test('narrow power band: m stays at the fallback, c still fitted', () => {
  const m = new SpeedModel()
  cruise(m, [400, 440, 480, 520, 560, 600], (w) => C * Math.pow(w, 0.45))
  assert.equal(m.exp, M_DEFAULT)
  // c fitted under m = 1/3 from data that follows 0.45: right at the band's middle.
  assert.ok(Math.abs(/** @type {number} */ (m.speedAt(490)) - C * Math.pow(490, 0.45)) / (C * Math.pow(490, 0.45)) < 0.03)
})

test('outliers (10 % of samples at +20 % speed, as if sailing) barely move the fit', () => {
  const m = new SpeedModel()
  let t = 0
  let block = 0
  for (const w of spread) {
    for (let rep = 0; rep < 3; rep++, block++) {
      const factor = block % 10 === 0 ? 1.2 : 1
      m.window = []
      for (let s = 0; s < 20; s++, t += 1000) m.observe(w, C * Math.pow(w, 1 / 3) * factor, true, t)
    }
  }
  assert.ok(Math.abs(m.exp - 1 / 3) / (1 / 3) < 0.05, `m=${m.exp}`)
  assert.ok(Math.abs(/** @type {number} */ (m.coef) - C) / C < 0.05, `c=${m.coef}`)
})

test('non-steady STW and low speeds are rejected; small noise at low speed is not', () => {
  const m = new SpeedModel()
  // ±0.3 m/s swell on 2 m/s: more than 5 % and more than 0.1 m/s.
  cruise(m, [500], (w, i) => 2 + (i % 2 ? 0.3 : -0.3))
  assert.equal(m.samples.length, 0)
  cruise(m, [30], () => 0.25, undefined, 100000)
  assert.equal(m.samples.length, 0, 'below 0.3 m/s')
  // ±0.04 m/s on 0.5 m/s is 8 %, but within the 0.1 m/s floor.
  cruise(m, [40], (w, i) => 0.5 + (i % 2 ? 0.04 : -0.04), undefined, 200000)
  assert.ok(m.samples.length > 0)
})

test('caller gate (not in drive, sailing) rejects and resets the window', () => {
  const m = new SpeedModel()
  cruise(m, spread, (w) => C * Math.pow(w, 1 / 3), () => false)
  assert.equal(m.samples.length, 0)
  assert.equal(m.params(), undefined)
})

test('params: undefined until ready, configured fallback c used meanwhile', () => {
  assert.equal(new SpeedModel().speedAt(500), undefined)
  const f = new SpeedModel({ fallbackC: C })
  assert.ok(Math.abs(/** @type {number} */ (f.speedAt(500)) - 2.5) < 1e-9)
  assert.equal(f.params()?.learned, false)
  assert.equal(f.speedAt(0), undefined)
  assert.equal(f.speedAt(undefined), undefined)
  assert.equal(new SpeedModel({ fallbackC: C, fallbackM: 5 }).exp, 0.6, 'm clamped')
})

test('stwFactor rescales c, keeps m, and samples stay raw', () => {
  const a = new SpeedModel()
  cruise(a, spread, (w) => C * Math.pow(w, 1 / 3))
  const json = JSON.parse(JSON.stringify(a.toJSON()))
  const b = new SpeedModel({ stwFactor: 1.2 })
  b.load(json)
  assert.ok(Math.abs(/** @type {number} */ (b.coef) / /** @type {number} */ (a.coef) - 1.2) < 1e-9)
  assert.ok(Math.abs(b.exp - a.exp) < 1e-9)
  assert.deepEqual(b.toJSON().samples, a.toJSON().samples)
})

test('toJSON / load round trip, invalid entries dropped, never NaN', () => {
  const m = new SpeedModel()
  cruise(m, spread, (w) => C * Math.pow(w, 1 / 3))
  m.ratios.sectors[0].push(1.1, 1.2)
  const json = JSON.parse(JSON.stringify(m.toJSON()))
  json.samples.push(['x', 1, 2], [500, -1, 3], [500, NaN, 4])
  json.stwRatios[1] = [1, 'x', -2, null]
  const r = new SpeedModel()
  r.load(json)
  assert.equal(r.samples.length, m.samples.length)
  assert.ok(Math.abs(/** @type {number} */ (r.coef) - /** @type {number} */ (m.coef)) < 1e-12)
  assert.deepEqual(r.ratios.sectors[0], [1.1, 1.2])
  assert.deepEqual(r.ratios.sectors[1], [1])
  r.load(null)
  assert.equal(r.ready, false)
  assert.equal(r.ratios.sectors[0].length, 0)
  r.load({ samples: [[0, 0, 0]] })
  assert.equal(r.coef, undefined)
  assert.equal(r.speedAt(500), undefined)
})

/**
 * Log reads 90 % of the true STW; a 0.3 m/s current sets north.
 * @param {StwRatios} ratios
 * @param {number[]} sectors headings in degrees
 */
function motorAround (ratios, sectors, perSector = 12) {
  let t = 0
  const trueStw = 2
  const current = { n: 0.3, e: 0 }
  for (const deg of sectors) {
    const h = deg * Math.PI / 180
    const vn = trueStw * Math.cos(h) + current.n
    const ve = trueStw * Math.sin(h) + current.e
    const sog = Math.hypot(vn, ve)
    const cog = Math.atan2(ve, vn)
    for (let i = 0; i < perSector; i++, t += 5000) ratios.observe(trueStw * 0.9, sog, cog, true, t)
  }
}

test('suggested STW factor: current cancels over opposite headings', () => {
  const r = new StwRatios()
  motorAround(r, [0, 90, 180, 270])
  const s = r.suggestion()
  assert.ok(s)
  assert.equal(s.sectors, 4)
  assert.ok(Math.abs(s.factor - 1 / 0.9) < 0.02, `factor=${s.factor}`)
  assert.ok(s.spread > 0.2, 'current shows as spread')
})

test('suggested STW factor: needs 4 sectors with 10 samples each', () => {
  const r = new StwRatios()
  motorAround(r, [0, 90, 180])
  assert.equal(r.suggestion(), undefined)
  const few = new StwRatios()
  motorAround(few, [0, 90, 180, 270], 9)
  assert.equal(few.suggestion(), undefined)
  // At most one ratio every 5 s, and nothing without a fresh gate.
  const once = new StwRatios()
  assert.equal(once.observe(2, 2, 0, true, 0), true)
  assert.equal(once.observe(2, 2, 0, true, 1000), false)
  assert.equal(once.observe(2, 2, 0, false, 10000), false)
  assert.equal(once.observe(0.2, 2, 0, true, 20000), false)
  assert.equal(once.observe(2, 2, -0.1, true, 30000), true, 'negative COG wraps')
  assert.equal(once.sectors[7].length, 1)
})

test('reset clears samples and ratios', () => {
  const m = new SpeedModel()
  cruise(m, spread, (w) => C * Math.pow(w, 1 / 3))
  m.ratios.sectors[2].push(1)
  m.reset()
  assert.equal(m.samples.length, 0)
  assert.equal(m.ratios.sectors[2].length, 0)
  assert.equal(m.exp, M_DEFAULT)
})
