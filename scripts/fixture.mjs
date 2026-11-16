// Simulated plugin data for webapp screenshots without a Signal K server
// (plan 12). Dev only. Two variants: `winter` (forecast, no speed log: the
// boat over the winter) and `log` (learned speed model, active route).
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const H = 3600000
const KN = 1852 / 3600
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }

/** @param {number} now @param {'winter'|'log'} variant */
export function fixture (now, variant) {
  const sunrise = now - 3.25 * H
  const sunset = now + 5.5 * H
  const day = sunset - sunrise
  const sun = (t) => Math.max(0, 900 * Math.sin(Math.PI * (t - sunrise) / day))
  const hour0 = Math.floor(now / H) * H
  const hours = []
  for (let t = hour0; t <= sunset + H; t += H) hours.push({ t: new Date(t).toISOString(), solarW: Math.round(sun(t + H / 2)), houseW: 60 })
  const best = { start: now + 0.5 * H, end: now + 3.5 * H }
  const log = variant === 'log'
  const snapshot = {
    t: now,
    mode: 'active',
    inDrive: true,
    solarW: 820,
    houseW: 60,
    houseSource: 'dcSystem',
    socBiasW: 0,
    forecastBiasW: 120,
    forecastStatus: 'surplus',
    budgetW: 880,
    motorW: 850,
    balanceW: 30,
    matchState: 'matched',
    sunrise,
    sunset,
    dayBudgetW: 520,
    dayBudgetBasis: 'neutral',
    bestHours: best
  }
  if (log) {
    Object.assign(snapshot, {
      stw: 2.6 * KN,
      speedAtBudget: 2.3 * KN,
      rangeUntilSunsetM: 12.6 * 1852,
      rangeBasis: 'dayBudget',
      current: { setTrue: (200 * Math.PI) / 180, drift: 0.5 * KN, source: 'estimated' },
      waypoint: { distanceM: 3.1 * 1852, eta: now + 1.5 * H, afterSunset: false, requiredPowerW: 210, currentCorrected: true, currentAlongMps: -0.4 * KN },
      destination: { distanceM: 14.2 * 1852, eta: now + 6.2 * H, afterSunset: true, requiredPowerW: 660, currentCorrected: false }
    })
  }
  const status = {
    available: true,
    timestamp: new Date(now).toISOString(),
    snapshot,
    sources: {
      solar: [{ id: '278', watts: 512, stale: false }, { id: '279', watts: 308, stale: false }],
      solarFallback: false,
      motor: { id: '99', watts: 850, rpm: 1150, gearRatio: 2, direction: 1, inDrive: true, temperatures: { temperature: 303.15, controllerTemperature: 306.15 }, stale: false },
      battery: { id: '288', soc: 0.74, watts: -30, stale: false },
      stw: log ? { mps: 2.6 * KN, stale: false } : null,
      course: log ? { nextM: 3.1 * 1852, routeM: 14.2 * 1852, bearingTrue: 0.4, stale: false } : null
    },
    forecast: { status: 'surplus', stale: false, age: 600, hours },
    propeller: { ready: true, samples: 120, n: 1.35, k: 0.01 },
    speed: log
      ? { ready: true, samples: 84, c: 0.08, m: 0.34, stwFactor: 1, stwFactorSuggested: 1.07, stwFactorSpread: 0.02, stwFactorSectors: 5 }
      : { ready: false, samples: 0, c: null, m: 0.333, stwFactor: 1, stwFactorSuggested: null }
  }
  const iso = (t) => new Date(t).toISOString()
  const values = {
    solarPower: 820, houseLoad: 60, socBias: 0, forecastBias: 120, budget: 880, motorPower: 850, balance: 30,
    matchState: 'matched', targetRevolutions: 19.6, targetShaftRevolutions: 9.8,
    solarEnergyToday: 2100 * 3600, motorEnergyToday: 1250 * 3600,
    dayBudget: 520, dayBudgetBasis: 'neutral', sunsetTargetSoc: null,
    sunset: iso(sunset), bestHoursStart: iso(best.start), bestHoursEnd: iso(best.end),
    speedAtBudget: log ? snapshot.speedAtBudget : null,
    rangeUntilSunset: log ? snapshot.rangeUntilSunsetM : null
  }
  const meta = {}
  const W = { units: 'W' }
  for (const k of ['solarPower', 'houseLoad', 'socBias', 'forecastBias', 'budget', 'motorPower', 'balance', 'dayBudget']) meta[k] = { meta: W }
  meta.targetRevolutions = { meta: { units: 'Hz', displayUnits: { formula: 'value * 60', symbol: 'rpm' } } }
  meta.targetShaftRevolutions = meta.targetRevolutions
  meta.speedAtBudget = { meta: { units: 'm/s', displayUnits: { category: 'speed', targetUnit: 'kn', formula: 'value * 1.94384', symbol: 'kn' } } }
  meta.rangeUntilSunset = { meta: { units: 'm', displayUnits: { category: 'distance', targetUnit: 'naut-mile', formula: 'value * 0.000539957', symbol: 'nm' } } }
  return { status, values, meta }
}

/**
 * Serve `public/` and the plugin's endpoints on `base`, and feed the stream.
 * @param {import('playwright').Page} page
 * @param {string} base e.g. http://fixture.test/signalk-solar-sailing/
 * @param {'winter'|'log'} variant
 * @param {{ night?: boolean, offline?: boolean }} opts
 * @returns {Promise<() => void>} stops the stream timers
 */
export async function serveFixture (page, base, variant, opts) {
  const origin = new URL(base).origin
  const prefix = new URL(base).pathname
  const data = () => fixture(Date.now(), variant)
  const timers = []
  await page.route(origin + '/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith(prefix)) return route.fulfill({ status: 404, body: '' })
    const rel = normalize(path.slice(prefix.length) || 'index.html').replace(/^(\.\.[/\\])+/, '')
    try {
      const body = await readFile(join('public', rel))
      return route.fulfill({ status: 200, contentType: TYPES[extname(rel)] || 'application/octet-stream', body })
    } catch (e) {
      return route.fulfill({ status: 404, body: '' })
    }
  })
  await page.route(origin + '/signalk/v2/api/resources/solar-sailing/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data().status) }))
  await page.route(origin + '/signalk/v1/api/vessels/self/plugin/solarsailing', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data().meta) }))
  await page.routeWebSocket(/signalk\/v1\/stream/, (ws) => {
    if (opts.offline) return ws.close()
    const push = () => {
      const d = data()
      const values = Object.entries(d.values).map(([k, v]) => ({ path: 'plugin.solarsailing.' + k, value: v }))
      values.push({ path: 'environment.mode', value: opts.night ? 'night' : 'day' })
      values.push({ path: 'environment.time.timezoneOffset', value: 100 })
      ws.send(JSON.stringify({ context: 'vessels.self', updates: [{ timestamp: new Date().toISOString(), values }] }))
    }
    ws.onMessage(() => push())
    timers.push(setInterval(push, 1000))
  })
  return () => timers.forEach((t) => clearInterval(t))
}
