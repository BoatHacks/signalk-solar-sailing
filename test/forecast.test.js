import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HOUR_MS, bestHours, dayBudget, energyBetween, forecastBias, forecastSunTimes, nightHouseWh,
  parseForecast, parseHours, remainingUntil, sunsetTarget
} from '../lib/forecast.js'
import { LastValueCache } from '../lib/cache.js'
import { resolveConfig } from '../lib/config.js'

const MAX_AGE = 180 * 60000
const RUN = Date.parse('2026-11-15T14:15:02.286Z')
const NOW = Date.parse('2026-11-15T14:30:00Z')
const MIDNIGHT = Date.parse('2026-11-14T23:00:00Z') // ship time +01:00
const cfg = (o = {}) => resolveConfig(o).config

/** The captured predictor subtree (fresh copy per call). */
function fixture () {
  const url = new URL('./fixtures/energy-prediction-2026-11-15.json', import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')).electrical.energy.prediction
}

/** Fixture with a surplus window added by hand. */
function withSurplus (wh = 1200, to = '2026-11-15T16:30:02.286Z') {
  const node = fixture()
  const ts = node.status.timestamp
  node.status.value = 'surplus'
  node.surplus = { value: wh, timestamp: ts, from: { value: '2026-11-15T14:15:02.286Z', timestamp: ts }, to: { value: to, timestamp: ts } }
  node.timeToFull = { value: '2026-11-15T15:00:00.000Z', timestamp: ts }
  return node
}

/** @param {[number, number][]} pairs solarWh, houseWh per slot from `start` */
const slots = (start, pairs) => pairs.map(([solarWh, houseWh], i) => ({ t: start + i * HOUR_MS, solarWh, houseWh }))

test('parseForecast: the captured run', () => {
  const f = parseForecast(fixture(), NOW, MAX_AGE)
  assert.ok(f)
  assert.equal(f.stale, false)
  assert.equal(f.time, RUN)
  assert.equal(f.status, 'stable')
  assert.equal(f.hours.length, 24)
  assert.deepEqual(f.hours[0], { t: RUN, solarWh: 11, houseWh: 38 })
  assert.equal(f.timeToFull, undefined)
  assert.equal(f.surplusWh, 0)
  assert.equal(f.surplusTo, undefined)
})

test('parseForecast: JSON string, malformed entries, slots off the clock hour', () => {
  const node = fixture()
  const hours = node.forecast.hourly.value
  hours[1] = { time: 'not a time', idealSolarYieldWh: 1, houseLoadWh: 1 }
  hours[2] = { time: hours[2].time, idealSolarYieldWh: 'x', houseLoadWh: 1 }
  hours[3] = null
  node.forecast.hourly.value = JSON.stringify(hours)
  const f = parseForecast(node, NOW, MAX_AGE)
  assert.ok(f)
  assert.equal(f.hours.length, 21)
  assert.equal(new Date(f.hours[0].t).toISOString().slice(13), ':15:02.286Z')
  assert.equal(parseHours('{bad json'), undefined)
  assert.equal(parseHours({}), undefined)
})

test('parseForecast: hours that ended are dropped; stale by age and when all are past', () => {
  const later = RUN + 2.5 * HOUR_MS
  const f = parseForecast(fixture(), later, MAX_AGE)
  assert.ok(f)
  assert.equal(f.hours[0].t, RUN + 2 * HOUR_MS, 'the slot containing now is kept')
  assert.equal(f.stale, false)
  assert.equal(parseForecast(fixture(), RUN + MAX_AGE + 1, MAX_AGE)?.stale, true)
  const past = parseForecast(fixture(), RUN + 25 * HOUR_MS, 30 * HOUR_MS)
  assert.deepEqual([past?.stale, past?.hours.length], [true, 0])
})

test('parseForecast: no object, no hourly → undefined', () => {
  assert.equal(parseForecast(undefined, NOW, MAX_AGE), undefined)
  assert.equal(parseForecast(42, NOW, MAX_AGE), undefined)
  assert.equal(parseForecast({ status: { value: 'stable' } }, NOW, MAX_AGE), undefined)
})

test('parseForecast: values left over from an older run are ignored', () => {
  const node = withSurplus()
  node.surplus.to.timestamp = '2026-11-15T13:15:00.000Z'
  node.timeToFull.timestamp = '2026-11-15T13:15:00.000Z'
  const f = parseForecast(node, NOW, MAX_AGE)
  assert.deepEqual([f?.surplusTo, f?.timeToFull, f?.surplusWh], [undefined, undefined, 1200])
})

test('remainingUntil: prorates both ends, never extrapolates', () => {
  const start = Date.parse('2026-11-15T10:15:00Z')
  const hours = slots(start, [[100, 20], [200, 40], [300, 60]])
  // From 10:45 (half of slot 0) to 12:45 (half of slot 2).
  const r = remainingUntil(hours, start + 0.5 * HOUR_MS, start + 2.5 * HOUR_MS)
  assert.deepEqual(r, { solarWh: 50 + 200 + 150, houseWh: 10 + 40 + 30 })
  assert.deepEqual(remainingUntil(hours, start - 2 * HOUR_MS, start - HOUR_MS), { solarWh: 0, houseWh: 0 }, 'sunset before the first entry')
  assert.deepEqual(remainingUntil(hours, start, start + 10 * HOUR_MS), { solarWh: 600, houseWh: 120 }, 'sunset past the last entry')
})

test('forecastSunTimes and nightHouseWh from the captured run', () => {
  const f = parseForecast(fixture(), NOW, MAX_AGE)
  assert.ok(f)
  const { sunset, nextSunrise } = forecastSunTimes(f.hours, MIDNIGHT)
  assert.equal(sunset, RUN + 3 * HOUR_MS, 'end of the last slot today above 5 Wh')
  assert.equal(nextSunrise, RUN + 18 * HOUR_MS, 'first slot tomorrow above 5 Wh')
  assert.equal(nightHouseWh(f.hours, /** @type {number} */ (sunset), /** @type {number} */ (nextSunrise)), 402)
  assert.equal(nightHouseWh(f.hours, RUN + 20 * HOUR_MS, RUN + 30 * HOUR_MS), undefined, 'night not covered')
  assert.deepEqual(forecastSunTimes(f.hours, MIDNIGHT + 24 * HOUR_MS), { sunset: RUN + 24 * HOUR_MS, nextSunrise: undefined })
  assert.equal(energyBetween(f.hours, RUN, RUN + HOUR_MS).coveredMs, HOUR_MS)
})

test('sunsetTarget: off by default, configured, raised by the night reserve', () => {
  assert.equal(sunsetTarget(cfg(), 402, 14500), undefined, 'default target 0 = off')
  assert.equal(sunsetTarget(cfg({ sunsetTargetSocPercent: 90 }), 402, 14500), 0.9)
  const raised = sunsetTarget(cfg({ sunsetTargetSocPercent: 15 }), 402, 14500)
  assert.ok(raised !== undefined && Math.abs(raised - (0.2 + 402 / 14500)) < 1e-12)
  assert.equal(sunsetTarget(cfg({ sunsetTargetSocPercent: 15 }), undefined, 14500), 0.2, 'no night forecast: floor alone')
  assert.equal(sunsetTarget(cfg({ sunsetTargetSocPercent: 90 }), 402, undefined), undefined, 'capacity unknown')
  assert.equal(sunsetTarget(cfg({ sunsetTargetSocPercent: 90 }), 402, 0), undefined)
})

test('dayBudget: neutral and target bases by hand', () => {
  const now = Date.parse('2026-11-15T12:00:00Z')
  const end = now + 4 * HOUR_MS
  const e = { solarWh: 2000, houseWh: 400 }
  const base = { socBiasW: 0, maxMotorPowerW: 0 }
  assert.deepEqual(dayBudget(e, now, end, base), { watts: 400, basis: 'neutral' })
  assert.deepEqual(dayBudget(e, now, end, { ...base, socBiasW: -100 }), { watts: 300, basis: 'neutral' })
  // Bank 0.9 → 0.8 of 14 500 Wh = 1450 Wh more over 4 h.
  const above = dayBudget(e, now, end, { ...base, soc: 0.9, target: 0.8, capacityWh: 14500, socBiasW: -100 })
  assert.equal(above?.basis, 'target')
  assert.ok(above && Math.abs(above.watts - (1600 + 1450) / 4) < 1e-9, 'socBias not added on the target basis')
  const below = dayBudget(e, now, end, { ...base, soc: 0.7, target: 0.8, capacityWh: 14500 })
  assert.ok(below && Math.abs(below.watts - (1600 - 1450) / 4) < 1e-9)
  assert.ok(below.watts < 400 && above.watts > 400)
  // Missing SoC or capacity → neutral.
  assert.equal(dayBudget(e, now, end, { ...base, target: 0.8, capacityWh: 14500 })?.basis, 'neutral')
  assert.equal(dayBudget(e, now, end, { ...base, soc: 0.9, target: 0.8 })?.basis, 'neutral')
})

test('dayBudget: clamps and the last 15 minutes', () => {
  const now = Date.parse('2026-11-15T12:00:00Z')
  const base = { socBiasW: 0, maxMotorPowerW: 0 }
  assert.equal(dayBudget({ solarWh: 100, houseWh: 900 }, now, now + HOUR_MS, base)?.watts, 0)
  assert.equal(dayBudget({ solarWh: 9000, houseWh: 0 }, now, now + HOUR_MS, { ...base, maxMotorPowerW: 5000 })?.watts, 5000)
  assert.equal(dayBudget({ solarWh: 100, houseWh: 0 }, now, now + 14 * 60000, base), undefined)
  assert.equal(dayBudget({ solarWh: 100, houseWh: 0 }, now, now - 60000, base), undefined, 'after sunset')
  assert.ok(dayBudget({ solarWh: 100, houseWh: 0 }, now, now + 15 * 60000, base))
})

test('forecastBias: surplus, deficit, critical, stale', () => {
  const c = cfg()
  const f = (/** @type {any} */ node, now = NOW) => parseForecast(node, now, MAX_AGE)
  // 1200 Wh until 16:30:02 (2 h from 14:30:02 ≈ 600 W) → capped at 300 W.
  assert.equal(forecastBias(f(withSurplus()), NOW, 80, c), 300)
  const small = forecastBias(f(withSurplus(200)), NOW, 80, c)
  assert.ok(Math.abs(small - 200 * 3600 / ((Date.parse('2026-11-15T16:30:02.286Z') - NOW) / 1000)) < 1e-9)
  assert.equal(forecastBias(f(withSurplus()), NOW, 40, c), 0, 'SoC below socLow: no assist')
  assert.equal(forecastBias(f(withSurplus()), NOW, undefined, c), 0, 'SoC unknown')
  const noFull = withSurplus()
  noFull.timeToFull.value = null
  assert.equal(forecastBias(f(noFull), NOW, 80, c), 0, 'bank never fills: nothing curtailed')
  assert.equal(forecastBias(f(withSurplus(1200, '2026-11-15T14:20:00Z')), NOW, 80, c), 0, 'surplus window over')
  const status = (/** @type {string} */ s) => { const n = fixture(); n.status.value = s; return n }
  assert.equal(forecastBias(f(status('deficit')), NOW, 80, c), -100)
  assert.equal(forecastBias(f(status('critical')), NOW, 80, c), -200)
  assert.equal(forecastBias(f(status('rising')), NOW, 80, c), 0)
  assert.equal(forecastBias(f(status('deficit'), RUN + MAX_AGE + 1), RUN + MAX_AGE + 1, 80, c), 0, 'stale')
  assert.equal(forecastBias(undefined, NOW, 80, c), 0)
})

test('bestHours: single peak, flat curve, short day, after sunset', () => {
  const start = Date.parse('2026-11-15T07:15:00Z')
  const peak = slots(start, [[10, 30], [100, 30], [300, 30], [400, 30], [300, 30], [100, 30], [10, 30]])
  const sunset = start + 7 * HOUR_MS
  assert.deepEqual(bestHours(peak, start, sunset, 3), { start: start + 2 * HOUR_MS, end: start + 5 * HOUR_MS })
  const flat = slots(start, [[100, 0], [100, 0], [100, 0], [100, 0], [100, 0]])
  const now = start + 0.25 * HOUR_MS
  assert.deepEqual(bestHours(flat, now, start + 5 * HOUR_MS, 3), { start: now, end: now + 3 * HOUR_MS }, 'earliest wins')
  const late = start + 5.5 * HOUR_MS
  assert.deepEqual(bestHours(peak, late, sunset, 3), { start: late, end: sunset }, 'less day left than the window')
  assert.equal(bestHours(peak, sunset + 1, sunset, 3), undefined)
  assert.equal(bestHours(peak, start, undefined, 3), undefined)
  assert.equal(bestHours([], start, sunset, 3), undefined)
})

test('cache: deltas under the prefix, null ignored, seeded from lastValue', () => {
  const cache = new LastValueCache('electrical.energy.prediction')
  const t = RUN
  const ts = new Date(t).toISOString()
  cache.applyDelta({ updates: [{ timestamp: ts, values: [
    { path: 'electrical.energy.prediction.status', value: 'stable' },
    { path: 'electrical.energy.prediction.forecast.hourly', value: fixture().forecast.hourly.value },
    { path: 'electrical.solar.278.panelPower', value: 5 }
  ] }] }, t)
  // The server's 60 s timeout nulls the value: the cache keeps the last one.
  cache.applyDelta({ updates: [{ timestamp: new Date(t + 61000).toISOString(), values: [
    { path: 'electrical.energy.prediction.status', value: null },
    { path: 'electrical.energy.prediction.forecast.hourly', value: null }
  ] }] }, t + 61000)
  const f = parseForecast(cache.tree(), NOW, MAX_AGE)
  assert.deepEqual([f?.status, f?.hours.length, f?.time], ['stable', 24, t])
  assert.equal(cache.tree().electrical, undefined)
  // Ages out by forecastMaxAgeMinutes.
  assert.equal(parseForecast(cache.tree(), t + MAX_AGE + 1, MAX_AGE)?.stale, true)

  // Seed from a timed-out tree: real data sits in state.lastValue.
  const node = fixture()
  node.status = { value: null, timestamp: node.status.timestamp, state: { timedOut: true, lastValue: 'deficit' } }
  const seeded = new LastValueCache('electrical.energy.prediction')
  seeded.seed(node, NOW)
  const g = parseForecast(seeded.tree(), NOW, MAX_AGE)
  assert.deepEqual([g?.status, g?.hours.length, g?.time], ['deficit', 24, RUN])
  seeded.seed(undefined, NOW)
  seeded.clear()
  assert.equal(parseForecast(seeded.tree(), NOW, MAX_AGE), undefined)
})
