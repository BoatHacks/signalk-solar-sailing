import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CurrentEstimator, components, fromVector, speedMadeGood, stwNeeded, toVector, CURRENT_MIN_MS } from '../lib/current.js'

const DEG = Math.PI / 180

/**
 * Boat at `stw` on `heading` in a current; ground track as a GPS sees it.
 * @param {number} stw @param {number} heading @param {{ setTrue: number, drift: number }} c
 */
function track (stw, heading, c) {
  const w = toVector(stw, heading)
  const k = toVector(c.drift, c.setTrue)
  const n = w.n + k.n
  const e = w.e + k.e
  const g = fromVector(n, e)
  return { stw, heading, sog: g.drift, cog: g.setTrue }
}

test('vectors: set is where the current flows to, 0..2π', () => {
  const v = fromVector(...Object.values(toVector(1, 270 * DEG)))
  assert.ok(Math.abs(v.setTrue - 270 * DEG) < 1e-9)
  assert.ok(Math.abs(v.drift - 1) < 1e-9)
})

test('along and across a bearing', () => {
  const c = { setTrue: 0, drift: 0.5 }
  const head = components(c, 180 * DEG)
  assert.ok(Math.abs(head.along + 0.5) < 1e-9, 'foul current')
  const fair = components(c, 0)
  assert.ok(Math.abs(fair.along - 0.5) < 1e-9)
  const beam = components(c, 90 * DEG)
  assert.ok(Math.abs(beam.along) < 1e-9)
  assert.ok(Math.abs(Math.abs(beam.across) - 0.5) < 1e-9)
})

test('speed made good and speed needed are inverses', () => {
  for (const c of [{ along: -0.5, across: 0 }, { along: 0.3, across: 0.4 }, { along: 0, across: -0.6 }]) {
    const stw = stwNeeded(1.5, c)
    assert.ok(Math.abs(speedMadeGood(stw, c) - 1.5) < 1e-9, JSON.stringify(c))
  }
  // 0.5 kn foul at 2.5 kn: 20 % less over ground.
  const kn = 1852 / 3600
  assert.ok(Math.abs(speedMadeGood(2.5 * kn, { along: -0.5 * kn, across: 0 }) - 2 * kn) < 1e-9)
  assert.equal(speedMadeGood(0.5, { along: 0, across: 0.6 }), 0, 'cannot hold the line')
  assert.equal(speedMadeGood(0.5, { along: -1, across: 0 }), 0, 'set back')
  assert.equal(stwNeeded(0.3, { along: 0.5, across: 0 }), 0, 'the current alone is enough')
})

test('estimator recovers a steady current from ground and water tracks', () => {
  const truth = { setTrue: 200 * DEG, drift: 0.4 }
  const e = new CurrentEstimator()
  let t = 0
  for (const h of [0, 45, 90]) {
    for (let i = 0; i < 60; i++, t += 1000) e.observe(track(2, h * DEG, truth), t)
  }
  const v = e.value(t)
  assert.ok(v)
  assert.equal(v.source, 'estimated')
  assert.ok(Math.abs(v.drift - 0.4) < 1e-6)
  assert.ok(Math.abs(v.setTrue - truth.setTrue) < 1e-6)
})

test('estimator: needs a minute of data, drops old data, ignores low STW', () => {
  const truth = { setTrue: 0, drift: 0.4 }
  const e = new CurrentEstimator()
  let t = 0
  for (; t < CURRENT_MIN_MS; t += 1000) e.observe(track(2, 1, truth), t)
  assert.equal(e.value(t), undefined, 'under a minute')
  e.observe(track(2, 1, truth), t)
  assert.ok(e.value(t))
  assert.equal(e.value(t + 121000), undefined, 'too old')
  assert.equal(e.observe(track(0.2, 1, truth), t + 1000), false)
  assert.equal(e.observe({ stw: 2, heading: undefined, sog: 2, cog: 0 }, t + 2000), false)
})

test('estimator follows a change of current over about five minutes', () => {
  const e = new CurrentEstimator()
  let t = 0
  for (; t < 600000; t += 1000) e.observe(track(2, 0, { setTrue: 0, drift: 0.4 }), t)
  for (const end = t + 300000; t < end; t += 1000) e.observe(track(2, 0, { setTrue: Math.PI, drift: 0.4 }), t)
  const v = e.value(t)
  assert.ok(v && v.drift < 0.25, 'most of the way there after one time constant')
  assert.ok(Math.abs(v.setTrue - Math.PI) < 1e-6)
})
