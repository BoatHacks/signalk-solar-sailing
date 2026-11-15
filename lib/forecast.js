// Solar forecast maths (plan 10): parse signalk-energy-predictor's values,
// energy left until sunset, day budget, forecast bias and best hours. Pure:
// every function takes plain values and `now`.

import { finite, getIn } from './power.js'
import { clamp } from './matcher.js'

/** @typedef {import('./types.js').ForecastHour} ForecastHour */
/** @typedef {import('./types.js').ForecastReading} ForecastReading */

export const HOUR_MS = 3600000
/** No day budget in the last 15 min of daylight: the division blows up. */
export const MIN_DAY_LEFT_MS = 15 * 60000
/** A forecast hour above this much solar counts as daylight (forecast sunset). */
export const DAYLIGHT_WH = 5
/** Leaves written more than this before the forecast run belong to an older run. */
const RUN_SLACK_MS = 60000
const STATUSES = ['surplus', 'rising', 'stable', 'deficit', 'critical']

/**
 * Value of a leaf whatever its type ({ value } or bare value).
 * @param {unknown} leaf
 */
function raw (leaf) {
  if (leaf && typeof leaf === 'object' && !Array.isArray(leaf) && 'value' in leaf) return /** @type {any} */ (leaf).value
  return leaf
}

/** @param {unknown} leaf */
function time (leaf) {
  const ts = leaf && typeof leaf === 'object' ? /** @type {any} */ (leaf).timestamp : undefined
  const t = typeof ts === 'string' ? Date.parse(ts) : NaN
  return Number.isNaN(t) ? undefined : t
}

/** @param {unknown} v */
function isoMs (v) {
  if (typeof v !== 'string') return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : t
}

/**
 * Forecast hours from the predictor's `forecast.hourly` value. Accepts an
 * array or a JSON string; entries without a time or numbers are skipped.
 * @param {unknown} value
 * @returns {ForecastHour[] | undefined} undefined when not an array at all
 */
export function parseHours (value) {
  let v = value
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return undefined
    }
  }
  if (!Array.isArray(v)) return undefined
  /** @type {ForecastHour[]} */
  const out = []
  for (const e of v) {
    if (!e || typeof e !== 'object') continue
    const t = isoMs(e.time)
    if (t === undefined || !finite(e.idealSolarYieldWh) || !finite(e.houseLoadWh)) continue
    out.push({ t, solarWh: Math.max(0, e.idealSolarYieldWh), houseWh: Math.max(0, e.houseLoadWh) })
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * The predictor's subtree (`electrical.energy.prediction`, tree shape) to a
 * reading. Values from an older run than `forecast.hourly` are ignored, so a
 * `surplus.to` or `timeToFull` left over from an earlier run never counts.
 * @param {unknown} node
 * @param {number} now
 * @param {number} maxAgeMs
 * @returns {ForecastReading | undefined}
 */
export function parseForecast (node, now, maxAgeMs) {
  if (!node || typeof node !== 'object') return undefined
  const hourlyLeaf = getIn(node, 'forecast.hourly')
  const all = parseHours(raw(hourlyLeaf))
  if (!all) return undefined
  const runTime = time(hourlyLeaf) ?? (all.length ? all[0].t : undefined)
  /** @param {string} path */
  const current = (path) => {
    const leaf = getIn(node, path)
    const t = time(leaf)
    if (runTime !== undefined && t !== undefined && t < runTime - RUN_SLACK_MS) return undefined
    return raw(leaf)
  }
  const hours = all.filter((h) => h.t + HOUR_MS > now)
  const status = current('status')
  const surplus = current('surplus')
  const stale = runTime === undefined || now - runTime > maxAgeMs || hours.length === 0
  return {
    time: runTime,
    stale,
    hours,
    status: typeof status === 'string' && STATUSES.includes(status) ? /** @type {ForecastReading['status']} */ (status) : undefined,
    timeToFull: isoMs(current('timeToFull')),
    surplusWh: finite(surplus) ? surplus : undefined,
    surplusFrom: isoMs(current('surplus.from')),
    surplusTo: isoMs(current('surplus.to'))
  }
}

/**
 * Forecast energy in [from, to), prorating partial hours by overlap. Slots
 * are [t, t + 1 h) and need not start on the clock hour. Never extrapolates
 * past the last slot.
 * @param {ForecastHour[]} hours
 * @param {number} from
 * @param {number} to
 * @returns {{ solarWh: number, houseWh: number, coveredMs: number }}
 */
export function energyBetween (hours, from, to) {
  let solarWh = 0
  let houseWh = 0
  let coveredMs = 0
  for (const h of hours) {
    const overlap = Math.min(h.t + HOUR_MS, to) - Math.max(h.t, from)
    if (overlap <= 0) continue
    const f = overlap / HOUR_MS
    solarWh += h.solarWh * f
    houseWh += h.houseWh * f
    coveredMs += overlap
  }
  return { solarWh, houseWh, coveredMs }
}

/**
 * Forecast solar and house energy from now until `end`.
 * @param {ForecastHour[]} hours
 * @param {number} now
 * @param {number} end
 */
export function remainingUntil (hours, now, end) {
  const { solarWh, houseWh } = energyBetween(hours, now, end)
  return { solarWh, houseWh }
}

/**
 * Forecast house energy through the night, or undefined when the forecast
 * does not cover the whole night.
 * @param {ForecastHour[]} hours
 * @param {number} sunset
 * @param {number} nextSunrise
 */
export function nightHouseWh (hours, sunset, nextSunrise) {
  if (!(nextSunrise > sunset)) return undefined
  const e = energyBetween(hours, sunset, nextSunrise)
  // Allow a second of rounding in the slot times.
  return e.coveredMs >= nextSunrise - sunset - 1000 ? e.houseWh : undefined
}

/**
 * Sunset and next sunrise from the forecast alone (no position): the end of
 * the last daylight slot that starts today, and the start of the first
 * daylight slot after it.
 * @param {ForecastHour[]} hours
 * @param {number} dayStartMs local midnight
 * @returns {{ sunset?: number, nextSunrise?: number }}
 */
export function forecastSunTimes (hours, dayStartMs) {
  const dayEnd = dayStartMs + 24 * HOUR_MS
  let sunset
  for (const h of hours) {
    if (h.t >= dayStartMs && h.t < dayEnd && h.solarWh > DAYLIGHT_WH) sunset = h.t + HOUR_MS
  }
  if (sunset === undefined) return {}
  const next = hours.find((h) => h.t >= sunset && h.solarWh > DAYLIGHT_WH)
  return { sunset, nextSunrise: next ? next.t : undefined }
}

/**
 * Effective sunset target SoC (ratio): the configured target, raised so the
 * bank gets through the night above the floor. Undefined when the target is
 * off or the capacity unknown.
 * @param {{ sunsetTargetSocPercent: number, minSocPercent: number }} config
 * @param {number | undefined} nightWh
 * @param {number | undefined} capacityWh
 */
export function sunsetTarget (config, nightWh, capacityWh) {
  if (!(config.sunsetTargetSocPercent > 0) || !(capacityWh !== undefined && capacityWh > 0)) return undefined
  const floor = config.minSocPercent / 100 + (nightWh || 0) / capacityWh
  return Math.min(1, Math.max(config.sunsetTargetSocPercent / 100, floor))
}

/**
 * Steady motor power that uses the forecast energy until `end` (sunset) and
 * lands on the sunset target, or ends SoC-neutral without one.
 * @param {{ solarWh: number, houseWh: number }} energy
 * @param {number} now
 * @param {number} end
 * @param {{ soc?: number, target?: number, capacityWh?: number, socBiasW: number, maxMotorPowerW: number }} o
 *   soc and target as ratios
 * @returns {{ watts: number, basis: 'target'|'neutral' } | undefined}
 */
export function dayBudget (energy, now, end, o) {
  const leftMs = end - now
  if (!(leftMs >= MIN_DAY_LEFT_MS)) return undefined
  const seconds = leftMs / 1000
  const hi = o.maxMotorPowerW > 0 ? o.maxMotorPowerW : Infinity
  const net = energy.solarWh - energy.houseWh
  if (o.target !== undefined && o.soc !== undefined && o.capacityWh !== undefined && o.capacityWh > 0) {
    const bankWh = (o.soc - o.target) * o.capacityWh
    return { watts: clamp((net + bankWh) * 3600 / seconds, 0, hi), basis: 'target' }
  }
  return { watts: clamp(net * 3600 / seconds + o.socBiasW, 0, hi), basis: 'neutral' }
}

/**
 * Forecast adjustment to the live budget (W).
 * @param {ForecastReading | undefined} f
 * @param {number} now
 * @param {number | undefined} socPercent
 * @param {{ socLowPercent: number, surplusAssistCapW: number, deficitReserveW: number, criticalReserveW: number }} config
 */
export function forecastBias (f, now, socPercent, config) {
  if (!f || f.stale) return 0
  if (f.status === 'deficit') return -config.deficitReserveW
  if (f.status === 'critical') return -config.criticalReserveW
  if (f.status === 'surplus' && f.timeToFull !== undefined && f.surplusTo !== undefined && f.surplusTo > now &&
      f.surplusWh !== undefined && f.surplusWh > 0 && socPercent !== undefined && socPercent > config.socLowPercent) {
    // Energy the charger would curtail anyway, spread until the surplus ends.
    const seconds = (f.surplusTo - now) / 1000
    return Math.min(f.surplusWh * 3600 / seconds, config.surplusAssistCapW)
  }
  return 0
}

/**
 * The window of `windowH` hours (shorter if less day is left) between now and
 * sunset with the most forecast net energy. Ties go to the earliest window.
 * @param {ForecastHour[]} hours
 * @param {number} now
 * @param {number | undefined} end sunset
 * @param {number} windowH
 * @returns {{ start: number, end: number } | undefined}
 */
export function bestHours (hours, now, end, windowH) {
  if (end === undefined || end <= now || !(windowH > 0) || hours.length === 0) return undefined
  const len = Math.min(windowH * HOUR_MS, end - now)
  const starts = new Set([now, end - len])
  for (const h of hours) {
    for (const t of [h.t, h.t + HOUR_MS, h.t - len, h.t + HOUR_MS - len]) {
      if (t > now && t + len <= end) starts.add(t)
    }
  }
  /** @type {{ start: number, end: number } | undefined} */
  let best
  let bestNet = -Infinity
  for (const start of [...starts].sort((a, b) => a - b)) {
    const e = energyBetween(hours, start, start + len)
    if (e.coveredMs === 0) continue
    const net = e.solarWh - e.houseWh
    if (net > bestNet + 1e-9) {
      bestNet = net
      best = { start, end: start + len }
    }
  }
  return best
}
