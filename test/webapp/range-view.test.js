import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rangeView, todayLine, todayWindow, forecastPoints, forecastPeak, sourceRows, xOf, CHART_W, CHART_PAD } from '../../public/js/view.js'

const T = Date.UTC(2026, 10, 16, 10, 0) // 11:00 ship time at +60
const H = 3600000
const KN = 1852 / 3600

const base = (over) => Object.assign({
  available: true,
  snapshot: { t: T, sunset: T + 5.5 * H, dayBudgetW: 400, rangeBasis: 'dayBudget' },
  sources: { stw: null, course: null },
  speed: { ready: false, samples: 0, stwFactor: 1, stwFactorSuggested: null }
}, over)

test('range panel without a speed log: shown greyed out with dashes', () => {
  const v = rangeView(base(), 60)
  assert.equal(v.state, 'nolog')
  assert.equal(v.speed, '-')
  assert.equal(v.unit, 'kn')
  assert.match(v.sub, /No speed log/)
  assert.deepEqual(v.lines, [])
  assert.equal(rangeView(undefined, 60).state, 'nolog')
  assert.equal(rangeView({ available: false }, 60).speed, '-')
})

test('range panel while learning, with the fouled-log hint', () => {
  const v = rangeView(base({
    sources: { stw: { mps: 1, stale: false } },
    speed: { ready: false, samples: 12, stwFactor: 1, stwFactorSuggested: 1.08, stwFactorSpread: 0.02 }
  }), 60)
  assert.equal(v.state, 'learning')
  assert.match(v.sub, /12 samples/)
  assert.match(v.hint, /suggested STW factor 1\.08 \(±0\.02\)/)
  // A suggestion close to the set factor is not worth a hint.
  const quiet = rangeView(base({ sources: { stw: { mps: 1, stale: false } }, speed: { ready: false, samples: 3, stwFactor: 1.07, stwFactorSuggested: 1.08 } }), 60)
  assert.equal(quiet.hint, '')
})

test('range panel ready: speed, basis, range and course lines', () => {
  const v = rangeView(base({
    snapshot: {
      t: T,
      sunset: T + 5.5 * H,
      dayBudgetW: 400,
      rangeBasis: 'dayBudget',
      speedAtBudget: 2.5 * KN,
      rangeUntilSunsetM: 13.75 * 1852,
      waypoint: { distanceM: 3.1 * 1852, eta: T + 2 * H + 5 * 60000, requiredPowerW: 250, currentCorrected: true, currentAlongMps: -0.4 * KN },
      destination: { distanceM: 14.2 * 1852, eta: T + 6 * H + 40 * 60000, afterSunset: true, requiredPowerW: 540, currentCorrected: false }
    },
    sources: { stw: null, course: { nextM: 3.1 * 1852, routeM: 14.2 * 1852 } },
    speed: { ready: true, samples: 60, m: 0.33, stwFactor: 1 }
  }), 60)
  assert.equal(v.state, 'ready')
  assert.equal(v.speed, '2.5')
  assert.equal(v.unit, 'kn')
  assert.equal(v.sub, 'At day budget: 13.8 nm until sunset, through water.')
  assert.equal(v.lines[0], 'WP 3.1 nm, 13:05, current −0.4 kn, needs 250 W')
  assert.equal(v.lines[1], 'Dest 14.2 nm, ETA 17:40, after sunset, needs 540 W (+140 W over day budget), through water')
})

test('single-point course shows one line; no ETA shows as such; after sunset', () => {
  const v = rangeView(base({
    snapshot: { t: T, sunset: T - H, rangeBasis: 'budget', speedAtBudget: 1, waypoint: { distanceM: 1852 }, destination: { distanceM: 1852 } },
    sources: { course: { nextM: 1852, routeM: null } },
    speed: { ready: true, samples: 60 }
  }), undefined)
  assert.equal(v.lines.length, 1)
  assert.equal(v.lines[0], 'WP 1 nm, no ETA, through water')
  assert.equal(v.sub, 'At live budget, after sunset.')
  // Without the model, the course line shows the distance only.
  const nolog = rangeView(base({ snapshot: { t: T, waypoint: { distanceM: 1852 } } }), 60)
  assert.deepEqual(nolog.lines, ['WP 1 nm'])
})

test('Today line: best hours and sunset in ship time', () => {
  const iso = (ms) => new Date(ms).toISOString()
  assert.equal(todayLine({ bestStart: iso(T + 0.5 * H), bestEnd: iso(T + 3.5 * H), sunset: iso(T + 5.5 * H) }, 60), 'best 11:30–14:30 · sunset 16:30')
  assert.equal(todayLine({ sunset: iso(T + 5.5 * H) }, 60), 'sunset 16:30')
  assert.equal(todayLine({ bestStart: null, bestEnd: null, sunset: null }, 60), '')
})

test('Today window: sunrise to sunset, 06:00 fallback, past sunset up to now', () => {
  const snap = { sunrise: T - 3.25 * H, sunset: T + 5.5 * H }
  assert.deepEqual(todayWindow(snap, T, 60), { t0: T - 3.75 * H, t1: T + 6 * H })
  // No sunrise: 06:00 ship time = 05:00Z.
  assert.equal(todayWindow({ sunset: T + 5.5 * H }, T, 60).t0, Date.UTC(2026, 10, 16, 5, 0))
  assert.equal(todayWindow(snap, T + 8 * H, 60).t1, T + 8 * H)
  assert.equal(todayWindow({}, T, 60), undefined)
})

test('forecast curve starts at now and stays inside the window', () => {
  const hours = [0, 1, 2, 3].map((i) => ({ t: new Date(T - 0.5 * H + i * H).toISOString(), solarW: 100 * (i + 1) }))
  const t0 = T - 2 * H
  const t1 = T + 2 * H
  const pts = forecastPoints(hours, T, t0, t1, 1000).split(' ')
  // now (slot 0), mids of slots 0..2 after now (T, T+H, T+2H): slot 0 mid = T is not after now.
  assert.equal(pts.length, 3)
  assert.equal(pts[0].split(',')[0], xOf(T, t0, t1).toFixed(1))
  assert.equal(Number(pts[2].split(',')[0]), Number((CHART_W - CHART_PAD.r).toFixed(1)))
  assert.equal(forecastPoints(null, T, t0, t1, 1000), '')
  assert.equal(forecastPeak(hours), 400)
  assert.equal(forecastPeak(null), 0)
})

test('sources gain forecast bias, STW, current and speed model rows', () => {
  const rows = sourceRows({
    available: true,
    snapshot: { forecastBiasW: 120, forecastStatus: 'surplus', current: { setTrue: Math.PI / 2, drift: 0.6 * KN, source: 'estimated' } },
    sources: { stw: { mps: 2 * KN, stale: false } },
    forecast: { stale: false, hours: [] },
    speed: { ready: false, samples: 5, m: 0.333 }
  })
  const byId = Object.fromEntries(rows.map((r) => [r[0], r]))
  assert.deepEqual([byId.forecast[1], byId.forecast[2]], ['Forecast bias (surplus)', '+120 W'])
  assert.equal(byId.stw[2], '2 kn')
  assert.deepEqual([byId.current[1], byId.current[2]], ['Current (estimated)', 'set 90°, 0.6 kn'])
  assert.equal(byId.speed[2], 'learning (5 samples)')
})

test('RPM card: target vs current, shaft below', async () => {
  const { rpmView } = await import('../../public/js/view.js')
  const status = { available: true, sources: { motor: { rpm: 1150.4, gearRatio: 2, stale: false } } }
  assert.deepEqual(rpmView(19.6, 9.8, status), { target: '1176', current: '1150', shaft: 'Shaft: target 588 · current 575 rpm' })
  assert.deepEqual(rpmView(undefined, undefined, undefined), { target: '-', current: '-', shaft: '' })
  const stale = { available: true, sources: { motor: { rpm: 1000, stale: true } } }
  assert.equal(rpmView(19.6, undefined, stale).current, '-')
  // No gear ratio: no current shaft value.
  assert.equal(rpmView(19.6, 9.8, { available: true, sources: { motor: { rpm: 1000, stale: false } } }).shaft, 'Shaft: target 588 · current - rpm')
})
