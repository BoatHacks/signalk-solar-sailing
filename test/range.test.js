import { test } from 'node:test'
import assert from 'node:assert/strict'
import { powerFor, rangeEstimate, targetEstimate } from '../lib/range.js'

const NOW = Date.parse('2026-11-15T12:00:00Z')
const SUNSET = NOW + 4 * 3600000
const C = 2.5 / Math.pow(500, 1 / 3)
const P = { c: C, m: 1 / 3, minPowerW: 100, maxPowerW: 1600 }
/** @param {number} w */
const v = (w) => C * Math.pow(w, 1 / 3)
const course = (/** @type {any} */ o = {}) => ({ nextM: 18000, routeM: 36000, time: NOW, stale: false, ...o })

test('basis: day budget when known, else the live budget', () => {
  const day = rangeEstimate({ params: P, budgetW: 300, dayBudgetW: 500, sunset: SUNSET, now: NOW })
  assert.equal(day.rangeBasis, 'dayBudget')
  assert.ok(Math.abs(/** @type {number} */ (day.speedAtBudget) - 2.5) < 1e-9)
  assert.ok(Math.abs(/** @type {number} */ (day.rangeUntilSunsetM) - 2.5 * 4 * 3600) < 1e-6)
  const live = rangeEstimate({ params: P, budgetW: 300, sunset: SUNSET, now: NOW })
  assert.equal(live.rangeBasis, 'budget')
  assert.ok(Math.abs(/** @type {number} */ (live.speedAtBudget) - v(300)) < 1e-9)
})

test('unknown: no model, no budget, budget 0, no sunset, after sunset', () => {
  assert.deepEqual(rangeEstimate({ budgetW: 500, sunset: SUNSET, course: course(), now: NOW }), {})
  const none = rangeEstimate({ params: P, sunset: SUNSET, now: NOW })
  assert.deepEqual([none.rangeBasis, none.speedAtBudget, none.rangeUntilSunsetM], [undefined, undefined, undefined])
  const zero = rangeEstimate({ params: P, budgetW: 0, sunset: SUNSET, now: NOW })
  assert.equal(zero.speedAtBudget, undefined)
  assert.equal(zero.rangeBasis, undefined)
  const noSun = rangeEstimate({ params: P, budgetW: 500, now: NOW })
  assert.ok(noSun.speedAtBudget !== undefined)
  assert.equal(noSun.rangeUntilSunsetM, undefined)
  const after = rangeEstimate({ params: P, budgetW: 500, sunset: NOW - 1000, now: NOW })
  assert.ok(after.speedAtBudget !== undefined)
  assert.equal(after.rangeUntilSunsetM, undefined)
})

test('requiredPower is the inverse of the speed law', () => {
  for (const w of [120, 500, 1500]) {
    assert.ok(Math.abs(/** @type {number} */ (powerFor(P, v(w))) - w) < 1e-6, String(w))
  }
  assert.equal(powerFor(P, 0), undefined)
})

test('requiredPower outside the learned power range by more than 50 %: unknown', () => {
  assert.ok(powerFor(P, v(2399.9)) !== undefined, '1.5 × max still trusted')
  assert.equal(powerFor(P, v(2400.1)), undefined)
  assert.ok(powerFor(P, v(50.01)) !== undefined, '0.5 × min still trusted')
  assert.equal(powerFor(P, v(49.9)), undefined)
  // A configured fallback has no learned range: no guard.
  assert.ok(powerFor({ c: C, m: 1 / 3 }, v(10000)) !== undefined)
})

test('waypoint and destination: route distance with a route, next point without', () => {
  const r = rangeEstimate({ params: P, budgetW: 500, sunset: SUNSET, course: course(), now: NOW })
  assert.ok(r.waypoint && r.destination)
  assert.equal(r.waypoint.distanceM, 18000)
  assert.equal(r.waypoint.eta, NOW + 18000 / 2.5 * 1000)
  assert.equal(r.waypoint.afterSunset, false)
  assert.ok(Math.abs(/** @type {number} */ (r.waypoint.requiredPowerW) - Math.pow(18000 / (4 * 3600) / C, 3)) < 1e-6)
  assert.ok(Math.abs(/** @type {number} */ (r.destination.requiredPowerW) - 500) < 1e-6, 'destination needs exactly the day budget')
  assert.equal(r.destination.distanceM, 36000)
  assert.equal(r.destination.eta, NOW + 36000 / 2.5 * 1000)
  assert.equal(r.destination.afterSunset, false)
  const single = rangeEstimate({ params: P, budgetW: 500, sunset: SUNSET, course: course({ routeM: undefined }), now: NOW })
  assert.deepEqual(single.destination, single.waypoint)
})

test('ETA after sunset is still given, flagged; required power says what it takes', () => {
  const r = rangeEstimate({ params: P, budgetW: 200, sunset: SUNSET, course: course({ routeM: 60000 }), now: NOW })
  const d = /** @type {import('../lib/types.js').TargetEstimate} */ (r.destination)
  assert.ok(/** @type {number} */ (d.eta) > SUNSET)
  assert.equal(d.afterSunset, true)
  assert.ok(/** @type {number} */ (d.requiredPowerW) > 200)
})

test('budget 0: no ETA, but the required power is still known', () => {
  const r = rangeEstimate({ params: P, budgetW: 0, sunset: SUNSET, course: course(), now: NOW })
  assert.ok(r.waypoint)
  assert.equal(r.waypoint.eta, undefined)
  assert.ok(r.waypoint.requiredPowerW !== undefined)
})

test('after sunset or without sunset: ETA without required power', () => {
  const after = targetEstimate(9000, P, 2.5, NOW - 1000, NOW)
  assert.ok(after && after.eta !== undefined)
  assert.equal(after.requiredPowerW, undefined)
  assert.equal(after.afterSunset, true)
  const noSun = targetEstimate(9000, P, 2.5, undefined, NOW)
  assert.ok(noSun && noSun.eta !== undefined)
  assert.equal(noSun.afterSunset, undefined)
  assert.equal(noSun.requiredPowerW, undefined)
})

test('no course or a stale one: no waypoint, no destination', () => {
  const none = rangeEstimate({ params: P, budgetW: 500, sunset: SUNSET, now: NOW })
  assert.deepEqual([none.waypoint, none.destination], [undefined, undefined])
  const stale = rangeEstimate({ params: P, budgetW: 500, sunset: SUNSET, course: course({ stale: true }), now: NOW })
  assert.deepEqual([stale.waypoint, stale.destination], [undefined, undefined])
  assert.equal(targetEstimate(-1, P, 2.5, SUNSET, NOW), undefined)
  assert.equal(targetEstimate(NaN, P, 2.5, SUNSET, NOW), undefined)
})
