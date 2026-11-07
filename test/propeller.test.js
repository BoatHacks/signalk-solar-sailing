import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PropellerModel, theilSen, median } from '../lib/propeller.js'
import { loadCurtisLog } from './helpers/tree.js'
import { replay } from './helpers/replay.js'
import { readMotor } from '../lib/sources.js'
import { resolveConfig } from '../lib/config.js'

/**
 * Hold each RPM for 60 s at 1 s ticks.
 * @param {PropellerModel} m
 * @param {number[]} rpms
 * @param {(rpm: number, i: number) => number} power
 */
function cruise (m, rpms, power, t0 = 0) {
  let t = t0
  let i = 0
  for (const rpm of rpms) {
    m.window = []
    for (let s = 0; s < 60; s++, t += 1000) m.observe(rpm, power(rpm, i++), true, t)
  }
  return t
}

const spread = [220, 260, 300, 340, 380, 420, 460, 500]

for (const n of [1.35, 3]) {
  test(`recovers k and n = ${n} within 5 %`, () => {
    const k = 138 / Math.pow(521, n)
    const m = new PropellerModel()
    cruise(m, spread, (rpm) => k * Math.pow(rpm, n))
    assert.ok(m.ready)
    assert.ok(Math.abs(m.n - n) / n < 0.05, `n=${m.n}`)
    assert.ok(Math.abs(m.k - k) / k < 0.05, `k=${m.k}`)
    const target = m.targetRpm(k * Math.pow(400, n))
    assert.ok(Math.abs(target - 400) < 1)
  })
}

test('outliers barely move the fit', () => {
  const k = 0.03
  const n = 1.35
  const m = new PropellerModel()
  // Every tenth accepted sample doubled: feed in steady blocks, flip power per block.
  let t = 0
  let block = 0
  for (const rpm of spread) {
    for (let rep = 0; rep < 3; rep++, block++) {
      const factor = block % 10 === 0 ? 2 : 1
      m.window = []
      for (let s = 0; s < 20; s++, t += 1000) m.observe(rpm, k * Math.pow(rpm, n) * factor, true, t)
    }
  }
  assert.ok(Math.abs(m.n - n) / n < 0.05, `n=${m.n}`)
  assert.ok(Math.abs(m.k - k) / k < 0.1, `k=${m.k}`)
})

test('narrow RPM band: n stays at the fallback, k still fitted', () => {
  const m = new PropellerModel()
  cruise(m, [300, 310, 320, 330, 340, 350], (rpm) => 2e-5 * Math.pow(rpm, 3))
  assert.equal(m.n, 3)
  assert.ok(Math.abs(m.k - 2e-5) / 2e-5 < 0.01)
})

test('transients are rejected as non-steady', () => {
  const m = new PropellerModel()
  let accepted = 0
  // 10 rpm/s, still far slower than the lever ramp in the log (~400 rpm/s).
  for (let t = 0; t < 30000; t += 1000) {
    const rpm = 220 + (t / 1000) * 10
    if (m.observe(rpm, 0.03 * Math.pow(rpm, 1.35), true, t)) accepted++
  }
  assert.equal(accepted, 0)
  assert.equal(m.observe(300, 50, false, 200000), false)
})

test('targetRpm undefined until ready unless a fallback k is configured', () => {
  assert.equal(new PropellerModel().targetRpm(200), undefined)
  const f = new PropellerModel({ fallbackK: 1e-5, fallbackN: 3 })
  assert.ok(Math.abs(f.targetRpm(270) - 300) < 1e-6)
  assert.equal(f.targetRpm(undefined), undefined)
  assert.equal(f.targetRpm(-5), 0)
})

test('toJSON / load round trip, invalid samples dropped', () => {
  const m = new PropellerModel()
  cruise(m, spread, (rpm) => 0.03 * Math.pow(rpm, 1.35))
  const json = JSON.parse(JSON.stringify(m.toJSON()))
  json.samples.push(['x', 1, 2], [-1, 5, 3])
  const r = new PropellerModel()
  r.load(json)
  assert.equal(r.samples.length, m.samples.length)
  assert.ok(Math.abs(r.k - m.k) < 1e-12)
  assert.equal(r.n, m.n)
  r.load(null)
  assert.equal(r.ready, false)
})

test('the 2026-10-25 log gives no fit or a valid one, never NaN', () => {
  const config = resolveConfig({ propulsionPath: 'propulsion.99' }).config
  const m = new PropellerModel()
  replay(loadCurtisLog().events, 1000, (tree, now) => {
    const motor = readMotor(tree, config, now)
    if (motor) m.observe(motor.rpm, motor.watts, motor.inDrive, now)
  })
  if (m.k !== undefined) {
    assert.ok(Number.isFinite(m.k))
    assert.ok(m.n >= 1 && m.n <= 3.5)
  }
})

test('theilSen and median helpers', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  const { slope, intercept } = theilSen([1, 2, 3, 4, 5], [3, 5, 7, 9, 100])
  assert.equal(slope, 2)
  assert.equal(intercept, 1)
})
