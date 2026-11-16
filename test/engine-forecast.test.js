import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Engine } from '../lib/engine.js'
import { resolveConfig } from '../lib/config.js'
import { readSources } from '../lib/sources.js'
import { HOUR_MS, parseForecast, remainingUntil } from '../lib/forecast.js'
import { sunTimes } from '../lib/sun.js'
import { loadCurtisLog } from './helpers/tree.js'
import { replay } from './helpers/replay.js'

const RUN = Date.parse('2026-11-15T14:15:02.286Z')
const NOW = Date.parse('2026-11-15T14:30:00Z')
const MAX_AGE = 180 * 60000
const KIEL = { lat: 54.3233, lon: 10.1228, time: NOW, stale: false }
const cfg = (o = {}) => resolveConfig({ smoothingSeconds: 0, ...o }).config

/** @param {(node: any) => void} [edit] */
function forecast (edit, now = NOW) {
  const url = new URL('./fixtures/energy-prediction-2026-11-15.json', import.meta.url)
  const node = JSON.parse(readFileSync(url, 'utf8')).electrical.energy.prediction
  if (edit) edit(node)
  return parseForecast(node, now, MAX_AGE)
}

/**
 * @param {{ solar?: number, dc?: number, soc?: number, position?: any, forecast?: any, motor?: number, capacityWh?: number }} o
 * @returns {import('../lib/types.js').Readings}
 */
function readings (o = {}) {
  return {
    solar: [{ id: '278', path: 'electrical.solar.278', watts: o.solar ?? 600, via: 'panelPower', time: NOW, stale: false }],
    solarFallback: false,
    motor: o.motor === undefined ? undefined : { id: '99', path: 'm', watts: o.motor, inDrive: o.motor > 15, direction: 1, temperatures: {}, time: NOW, stale: false },
    battery: o.soc === undefined && o.capacityWh === undefined ? undefined : { id: 'b', path: 'b', soc: o.soc, capacityWh: o.capacityWh, stale: false },
    dcSystem: { path: 'dc', watts: o.dc ?? 100, time: NOW, stale: false },
    timezoneOffsetMin: 60,
    position: o.position,
    forecast: o.forecast
  }
}

test('no forecast, no position: budget as before, new fields unknown', () => {
  const s = new Engine(cfg()).update(readings({ soc: 0.95 }), NOW)
  assert.equal(s.budgetW, 500)
  assert.equal(s.forecastBiasW, 0)
  for (const k of ['sunset', 'dayBudgetW', 'dayBudgetBasis', 'sunsetTargetSoc', 'solarRemainingJ', 'houseRemainingJ', 'bestHours', 'forecastStatus']) {
    assert.equal(/** @type {any} */ (s)[k], undefined, k)
  }
})

test('position alone gives the sunset, nothing that needs the forecast', () => {
  const s = new Engine(cfg()).update(readings({ position: KIEL }), NOW)
  assert.equal(s.sunset, sunTimes(KIEL.lat, KIEL.lon, Date.parse('2026-11-14T23:00:00Z')).sunset)
  assert.equal(s.sunrise, sunTimes(KIEL.lat, KIEL.lon, Date.parse('2026-11-14T23:00:00Z')).sunrise)
  assert.equal(s.dayBudgetW, undefined)
  assert.equal(s.bestHours, undefined)
  const stale = new Engine(cfg()).update(readings({ position: { ...KIEL, stale: true } }), NOW)
  assert.equal(stale.sunset, undefined)
})

test('forecast bias moves the live budget by exactly its value', () => {
  const plain = new Engine(cfg()).update(readings({ soc: 0.8 }), NOW)
  const stable = new Engine(cfg()).update(readings({ soc: 0.8, forecast: forecast() }), NOW)
  assert.equal(stable.budgetW, plain.budgetW, 'stable: no bias')
  const deficit = new Engine(cfg()).update(readings({ soc: 0.8, forecast: forecast((n) => { n.status.value = 'deficit' }) }), NOW)
  assert.equal(deficit.forecastBiasW, -100)
  assert.equal(deficit.budgetW, /** @type {number} */ (plain.budgetW) - 100)
  assert.equal(deficit.socBiasW, plain.socBiasW, 'socBias keeps its meaning')
  assert.equal(deficit.forecastStatus, 'deficit')
  // The match state stays against the live budget.
  const e = new Engine(cfg())
  const s = e.update(readings({ soc: 0.95, motor: 450, dc: 550, forecast: forecast((n) => { n.status.value = 'critical' }) }), NOW)
  assert.equal(s.budgetW, 600 - 100 - 200)
  assert.equal(s.matchState, 'over')
})

test('stale forecast is ignored, not read as no sun', () => {
  const late = RUN + MAX_AGE + 60000
  const f = forecast((n) => { n.status.value = 'critical' }, late)
  const s = new Engine(cfg()).update(readings({ forecast: f, position: KIEL }), late)
  assert.equal(s.forecastBiasW, 0)
  assert.equal(s.dayBudgetW, undefined)
  assert.equal(s.forecastStatus, undefined)
})

test('day budget, neutral basis, forecast sunset (no position)', () => {
  const f = forecast()
  assert.ok(f)
  const s = new Engine(cfg()).update(readings({ soc: 0.7, forecast: f }), NOW)
  const end = RUN + 3 * HOUR_MS
  assert.equal(s.sunset, end)
  const rem = remainingUntil(f.hours, NOW, end)
  assert.equal(s.dayBudgetBasis, 'neutral')
  assert.ok(Math.abs(/** @type {number} */ (s.dayBudgetW) - Math.max(0, (rem.solarWh - rem.houseWh) * 3600 / ((end - NOW) / 1000) + s.socBiasW)) < 1e-9)
  assert.equal(s.solarRemainingJ, rem.solarWh * 3600)
  assert.equal(s.houseRemainingJ, rem.houseWh * 3600)
  assert.equal(s.sunsetTargetSoc, undefined, 'target off by default')
  assert.ok(s.bestHours && s.bestHours.end <= end)
})

test('day budget, target basis: night reserve raises a low target', () => {
  const f = forecast()
  const c = cfg({ sunsetTargetSocPercent: 15 })
  const s = new Engine(c).update(readings({ soc: 0.9, forecast: f }), NOW)
  assert.equal(s.dayBudgetBasis, 'target')
  assert.ok(Math.abs(/** @type {number} */ (s.sunsetTargetSoc) - (0.2 + 402 / 14500)) < 1e-12)
  // A full bank in the morning may be spent: day budget far above neutral.
  const neutral = new Engine(cfg()).update(readings({ soc: 0.9, forecast: f }), NOW)
  assert.ok(/** @type {number} */ (s.dayBudgetW) > /** @type {number} */ (neutral.dayBudgetW))
})

test('target set but SoC or capacity unknown: neutral and the same day budget', () => {
  const f = forecast()
  const neutral = new Engine(cfg()).update(readings({ forecast: f }), NOW)
  const noSoc = new Engine(cfg({ sunsetTargetSocPercent: 90 })).update(readings({ forecast: f }), NOW)
  assert.deepEqual([noSoc.dayBudgetBasis, noSoc.dayBudgetW], ['neutral', neutral.dayBudgetW])
  const noCap = new Engine(cfg({ sunsetTargetSocPercent: 90, batteryCapacityWh: 0 })).update(readings({ soc: 0.5, forecast: f }), NOW)
  assert.equal(noCap.dayBudgetBasis, 'neutral')
  assert.equal(noCap.sunsetTargetSoc, undefined)
  // capacity 0 falls back to the bank's capacity.nominal.
  const nominal = new Engine(cfg({ sunsetTargetSocPercent: 90, batteryCapacityWh: 0 })).update(readings({ soc: 0.5, capacityWh: 10000, forecast: f }), NOW)
  assert.equal(nominal.dayBudgetBasis, 'target')
})

test('after sunset: sunset kept, day budget and best hours unknown', () => {
  const after = Date.parse('2026-11-15T16:00:00Z')
  const s = new Engine(cfg()).update(readings({ forecast: forecast(undefined, after), position: KIEL }), after)
  assert.ok(s.sunset !== undefined && s.sunset < after)
  assert.equal(s.dayBudgetW, undefined)
  assert.equal(s.bestHours, undefined)
  assert.equal(s.solarRemainingJ, undefined)
})

test('polar day: the horizon is the end of the forecast; polar night: none', () => {
  const svalbard = { lat: 78, lon: 15, time: NOW, stale: false }
  const night = new Engine(cfg()).update(readings({ forecast: forecast(), position: svalbard }), NOW)
  assert.deepEqual([night.sunset, night.dayBudgetW, night.bestHours], [undefined, undefined, undefined])

  const june = Date.parse('2026-06-21T10:00:00Z')
  const hours = Array.from({ length: 24 }, (_, i) => ({ t: june + i * HOUR_MS, solarWh: 300, houseWh: 50 }))
  const f = { time: june, stale: false, hours, status: /** @type {const} */ ('stable') }
  const day = new Engine(cfg()).update(readings({ forecast: f, position: { ...svalbard, time: june } }), june)
  assert.equal(day.sunset, undefined)
  assert.equal(day.solarRemainingJ, 24 * 300 * 3600)
  assert.ok(day.dayBudgetW !== undefined && Math.abs(day.dayBudgetW - 250 - day.socBiasW) < 1e-9, String(day.dayBudgetW))
})

test('idle mode still fills the forecast fields', () => {
  const s = new Engine(cfg()).update(readings({ forecast: forecast(), motor: 0 }), NOW)
  assert.equal(s.mode, 'idle')
  assert.ok(s.dayBudgetW !== undefined)
  assert.ok(s.bestHours)
})

test('Curtis replay: a stable forecast leaves budget, match state and target RPM unchanged', () => {
  const config = resolveConfig({ propulsionPath: 'propulsion.99' }).config
  const a = new Engine(config)
  const b = new Engine(config)
  let ticks = 0
  replay(loadCurtisLog().events, 1000, (tree, now) => {
    const r = readSources(tree, config, now)
    const sa = a.update(r, now)
    const f = parseForecast({ status: { value: 'stable', timestamp: new Date(now).toISOString() }, forecast: { hourly: { value: [], timestamp: new Date(now).toISOString() } } }, now, MAX_AGE)
    const sb = b.update({ ...r, forecast: f }, now)
    assert.deepEqual([sb.budgetW, sb.matchState, sb.targetRpm, sb.alarm], [sa.budgetW, sa.matchState, sa.targetRpm, sa.alarm])
    assert.equal(sa.forecastBiasW, 0)
    ticks++
  }, { 'electrical.solar.278.panelPower': 150 })
  assert.ok(ticks > 0)
})
