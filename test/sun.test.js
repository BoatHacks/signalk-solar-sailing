import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayStart, sunTimes } from '../lib/sun.js'

const MIN = 60000

/**
 * Reference times from the astral package (NOAA algorithm, −0.833° horizon),
 * which matches the published tables to the minute.
 * @param {number | undefined} actual
 * @param {string} expected ISO
 */
function near (actual, expected, tolMin = 2) {
  assert.ok(actual !== undefined, `expected ${expected}, got undefined`)
  const d = Math.abs(actual - Date.parse(expected)) / MIN
  assert.ok(d <= tolMin, `${new Date(actual).toISOString()} is ${d.toFixed(1)} min from ${expected}`)
}

test('Kiel in November', () => {
  const s = sunTimes(54.3233, 10.1228, dayStart(Date.parse('2026-11-15T12:00:00Z'), 60))
  near(s.sunrise, '2026-11-15T06:48:44Z')
  near(s.sunset, '2026-11-15T15:18:46Z')
  assert.equal(s.alwaysUp || s.alwaysDown, false)
})

test('equator at the equinox, west of Greenwich', () => {
  const s = sunTimes(0, -78.5, dayStart(Date.parse('2026-03-20T12:00:00Z'), -300))
  near(s.sunrise, '2026-03-20T11:18:17Z')
  near(s.sunset, '2026-03-20T23:24:27Z')
})

test('southern hemisphere summer: local day spans two UTC dates', () => {
  // Sydney, 21 December, AEDT (+11:00): sunrise is still 20 December in UTC.
  const s = sunTimes(-33.8688, 151.2093, dayStart(Date.parse('2026-12-21T02:00:00Z'), 660))
  near(s.sunrise, '2026-12-20T18:41:22Z')
  near(s.sunset, '2026-12-21T09:05:11Z')
})

test('polar day and polar night at 78° N', () => {
  const summer = sunTimes(78, 15, dayStart(Date.parse('2026-06-21T12:00:00Z'), 120))
  assert.deepEqual([summer.alwaysUp, summer.alwaysDown, summer.sunset], [true, false, undefined])
  const winter = sunTimes(78, 15, dayStart(Date.parse('2026-12-21T12:00:00Z'), 60))
  assert.deepEqual([winter.alwaysUp, winter.alwaysDown, winter.sunrise], [false, true, undefined])
})

test('day boundary follows the ship timezone offset', () => {
  const t = Date.parse('2026-11-15T23:30:00Z')
  assert.equal(dayStart(t, 120), Date.parse('2026-11-15T22:00:00Z'))
  assert.equal(dayStart(t, -570), Date.parse('2026-11-15T09:30:00Z'))
  assert.equal(dayStart(t, undefined), Date.parse('2026-11-15T00:00:00Z'))
  // 01:30 local on the 16th at +02:00 → sunset of the 16th, not the 15th.
  const kiel16 = sunTimes(54.3233, 10.1228, dayStart(t, 120)).sunset
  assert.ok(kiel16 !== undefined && kiel16 > t)
})
