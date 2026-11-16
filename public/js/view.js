// Pure view helpers for the elements: breakdown rows and chart geometry.
// Kept free of the DOM so they run in Node tests. ES2017.

import { withPrefix, round3, formatText, DEFAULT_META } from './units.js'
import { formatTime } from './time.js'

export const CHART_W = 600
export const CHART_H = 220
export const CHART_PAD = { l: 8, r: 8, t: 10, b: 22 }
const W = CHART_W
const H = CHART_H
const PAD = CHART_PAD

const watts = (v) => {
  if (typeof v !== 'number' || !isFinite(v)) return '-'
  const f = withPrefix(v, 'W')
  return f.text + ' ' + f.unit
}

const HOUSE = { dcSystem: 'DC system power', balance: 'battery balance', config: 'configured value' }

/**
 * Rows to show for a status reply: [id, label, value, stale].
 * @param {any} status
 */
export function sourceRows (status) {
  const rows = []
  if (!status || !status.available) return rows
  const src = status.sources || {}
  const solar = src.solar || []
  for (let i = 0; i < solar.length; i++) {
    const s = solar[i]
    rows.push(['solar-' + s.id, 'Solar ' + s.id + (src.solarFallback ? ' (system total)' : ''), s.stale ? 'stale' : watts(s.watts), s.stale])
  }
  if (!solar.length) rows.push(['solar-none', 'Solar', 'no charger found', true])
  const m = src.motor
  if (m) {
    rows.push(['motor', 'Motor ' + m.id, m.stale ? 'stale' : watts(m.watts), m.stale])
    if (typeof m.rpm === 'number') rows.push(['rpm', 'Motor RPM', round3(m.rpm), false])
    if (typeof m.gearRatio === 'number') rows.push(['gear', 'Gear ratio', round3(m.gearRatio) + ' : 1', false])
    if (typeof m.direction === 'number') rows.push(['dir', 'Direction', String(m.direction), false])
    const t = m.temperatures || {}
    if (typeof t.temperature === 'number') rows.push(['tmotor', 'Motor temperature', round3(t.temperature - 273.15) + ' °C', false])
    if (typeof t.controllerTemperature === 'number') rows.push(['tctrl', 'Controller temperature', round3(t.controllerTemperature - 273.15) + ' °C', false])
  } else {
    rows.push(['motor', 'Motor', 'not found', true])
  }
  const b = src.battery
  if (b) {
    rows.push(['soc', 'Battery ' + b.id + ' SoC', typeof b.soc === 'number' ? Math.round(b.soc * 100) + ' %' : '-', b.stale])
    rows.push(['bat', 'Battery ' + b.id + ' power', watts(b.watts), b.stale])
  }
  const snap = status.snapshot || {}
  rows.push(['house', 'House load (' + (HOUSE[snap.houseSource] || '-') + ')', watts(snap.houseW), false])
  if (status.forecast) {
    const fs = snap.forecastStatus ? ' (' + snap.forecastStatus + ')' : ''
    rows.push(['forecast', 'Forecast bias' + fs, signedWatts(snap.forecastBiasW), Boolean(status.forecast.stale)])
  }
  const p = status.propeller
  if (p) {
    rows.push(['prop', 'Propeller model', p.ready ? 'P = k·rpm^' + round3(p.n) : 'learning (' + p.samples + ' samples)', !p.ready])
  }
  const stw = src.stw
  if (stw) rows.push(['stw', 'Speed through water', stw.stale ? 'stale' : formatText(stw.mps, DEFAULT_META.speedAtBudget), stw.stale])
  const cur = snap.current
  if (cur) {
    rows.push(['current', 'Current (' + (cur.source === 'environment' ? 'environment.current' : 'estimated') + ')',
      'set ' + formatText(cur.setTrue, DEFAULT_META.currentSetTrue) + ', ' + formatText(cur.drift, DEFAULT_META.currentDrift), false])
  }
  const sp = status.speed
  if (sp) {
    rows.push(['speed', 'Speed model', sp.ready ? 'v = c·P^' + round3(sp.m) : 'learning (' + sp.samples + ' samples)', !sp.ready])
  }
  return rows
}

/**
 * Polyline points for one series; gaps (null) split nothing but are skipped.
 * @param {number[]} t
 * @param {Array<number|null>} ys
 * @param {number} t0
 * @param {number} t1
 * @param {number} ymax
 */
export function toPoints (t, ys, t0, t1, ymax) {
  const out = []
  const span = Math.max(1, t1 - t0)
  for (let i = 0; i < t.length; i++) {
    const y = ys[i]
    if (typeof y !== 'number') continue
    const x = PAD.l + ((t[i] - t0) / span) * (W - PAD.l - PAD.r)
    const yy = H - PAD.b - (Math.max(0, y) / ymax) * (H - PAD.t - PAD.b)
    out.push(x.toFixed(1) + ',' + yy.toFixed(1))
  }
  return out.join(' ')
}

/**
 * Peak value across the series, at least 100 W.
 * @param {{ solar: Array<number|null>, motor: Array<number|null>, budget: Array<number|null> }} p
 */
export function seriesPeak (p) {
  let max = 100
  const all = [p.solar, p.motor, p.budget]
  for (let s = 0; s < all.length; s++) {
    for (let i = 0; i < all[s].length; i++) {
      const v = all[s][i]
      if (typeof v === 'number' && v > max) max = v
    }
  }
  return max
}


/** @param {number | undefined} v */
function signedWatts (v) {
  if (typeof v !== 'number' || !isFinite(v)) return '-'
  return (v >= 0 ? '+' : '−') + watts(Math.abs(v))
}

/**
 * ISO string or ms → ms, else undefined.
 * @param {any} v
 */
export function toMs (v) {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN
  return isFinite(t) ? t : undefined
}

/**
 * The "Today" line under the day budget: best hours and sunset (plan 12).
 * Empty when neither is known.
 * @param {{ bestStart?: any, bestEnd?: any, sunset?: any }} v
 * @param {number | undefined} tz ship time offset, minutes
 */
export function todayLine (v, tz) {
  const parts = []
  const a = toMs(v.bestStart)
  const b = toMs(v.bestEnd)
  const ss = toMs(v.sunset)
  if (a !== undefined && b !== undefined) parts.push('best ' + formatTime(a, tz) + '–' + formatTime(b, tz))
  if (ss !== undefined) parts.push('sunset ' + formatTime(ss, tz))
  return parts.join(' · ')
}

const metaFor = (metaOf, key) => (metaOf && metaOf(key) && metaOf(key).units ? metaOf(key) : DEFAULT_META[key])

/**
 * One course target line for the range panel.
 * @param {string} label
 * @param {any} target TargetEstimate from the snapshot
 * @param {any} snap
 * @param {boolean} model speed model ready
 * @param {number | undefined} tz
 * @param {Function} [metaOf]
 */
export function targetLine (label, target, snap, model, tz, metaOf) {
  const parts = [label + ' ' + formatText(target.distanceM, metaFor(metaOf, 'rangeUntilSunset'))]
  if (!model) return parts.join(', ')
  parts.push(typeof target.eta === 'number' ? (label === 'WP' ? '' : 'ETA ') + formatTime(target.eta, tz) : 'no ETA')
  if (target.afterSunset) parts.push('after sunset')
  if (target.currentCorrected && typeof target.currentAlongMps === 'number') {
    const c = target.currentAlongMps
    parts.push('current ' + (c >= 0 ? '+' : '−') + formatText(Math.abs(c), metaFor(metaOf, 'waypointCurrent')))
  }
  if (typeof target.requiredPowerW === 'number') {
    let need = 'needs ' + watts(target.requiredPowerW)
    const day = snap.dayBudgetW
    if (typeof day === 'number' && target.requiredPowerW > day) need += ' (+' + watts(target.requiredPowerW - day) + ' over day budget)'
    parts.push(need)
  }
  if (!target.currentCorrected) parts.push('through water')
  return parts.join(', ')
}

/**
 * Everything the range panel shows (plan 12). States: `nolog` (no speed
 * through water and no learned model: panel greyed out with dashes),
 * `learning`, `ready`.
 * @param {any} status
 * @param {number | undefined} tz
 * @param {Function} [metaOf]
 */
export function rangeView (status, tz, metaOf) {
  const out = { state: 'nolog', speed: '-', unit: 'kn', sub: '', hint: '', lines: [] }
  const ok = status && status.available
  const snap = (ok && status.snapshot) || {}
  const src = (ok && status.sources) || {}
  const sp = ok ? status.speed : null
  const stw = src.stw
  const ready = Boolean(sp && sp.ready)
  if (!ok) {
    out.sub = 'Waiting for the plugin…'
    return out
  }
  if (ready) out.state = 'ready'
  else if (stw && !stw.stale) out.state = 'learning'
  if (out.state === 'nolog') {
    out.sub = 'No speed log: range needs speed through water.'
  } else if (out.state === 'learning') {
    out.sub = 'Learning speed from steady motoring (' + (sp ? sp.samples : 0) + ' samples).'
  } else {
    const f = metaFor(metaOf, 'speedAtBudget')
    const v = withUnit(snap.speedAtBudget, f)
    out.speed = v.text
    out.unit = v.unit || 'kn'
    const basis = snap.rangeBasis === 'dayBudget' ? 'At day budget' : 'At live budget'
    const ss = snap.sunset
    if (typeof ss === 'number' && ss <= snap.t) out.sub = basis + ', after sunset.'
    else if (typeof snap.rangeUntilSunsetM === 'number') out.sub = basis + ': ' + formatText(snap.rangeUntilSunsetM, metaFor(metaOf, 'rangeUntilSunset')) + ' until sunset, through water.'
    else out.sub = basis + '.'
  }
  if (sp && typeof sp.stwFactorSuggested === 'number' && Math.abs(sp.stwFactorSuggested - (sp.stwFactor || 1)) >= 0.03) {
    out.hint = 'Log may be fouled: suggested STW factor ' + round3(sp.stwFactorSuggested) +
      (typeof sp.stwFactorSpread === 'number' ? ' (±' + round3(sp.stwFactorSpread) + ')' : '') + ', set now ' + round3(sp.stwFactor || 1) + '.'
  }
  const course = src.course
  if (snap.waypoint) out.lines.push(targetLine('WP', snap.waypoint, snap, ready, tz, metaOf))
  if (snap.destination && course && course.routeM !== null && course.routeM !== undefined) {
    out.lines.push(targetLine('Dest', snap.destination, snap, ready, tz, metaOf))
  }
  return out
}

function withUnit (v, meta) {
  const s = formatText(v, meta)
  const i = s.indexOf(' ')
  return i < 0 ? { text: s, unit: '' } : { text: s.slice(0, i), unit: s.slice(i + 1) }
}

/** @param {number} t @param {number} t0 @param {number} t1 */
export function xOf (t, t0, t1) {
  return PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r)
}

/** @param {number} v @param {number} ymax */
export function yOf (v, ymax) {
  return H - PAD.b - (Math.max(0, v) / ymax) * (H - PAD.t - PAD.b)
}

const HOUR = 3600000
const HALF = HOUR / 2

/**
 * The chart's "Today" window: sunrise to sunset with half an hour either
 * side; 06:00 ship time when sunrise is unknown; runs on past sunset up to
 * now. Undefined without a sunset.
 * @param {any} snap
 * @param {number} now
 * @param {number | undefined} tz
 */
export function todayWindow (snap, now, tz) {
  const ss = snap && toMs(snap.sunset)
  if (ss === undefined) return undefined
  let t0
  const sr = toMs(snap.sunrise)
  if (sr !== undefined && sr < ss) t0 = sr - HALF
  else {
    const off = (tz || 0) * 60000
    t0 = Math.floor((ss + off) / (24 * HOUR)) * 24 * HOUR - off + 6 * HOUR
  }
  return { t0: t0, t1: Math.max(ss + HALF, now) }
}

/**
 * Forecast solar points from now on: the slot holding `now` starts the
 * line at now, then one point per slot middle, clipped to the window.
 * @param {Array<{ t: string, solarW: number }>} hours hourly slots
 * @param {number} now
 * @param {number} t0
 * @param {number} t1
 * @param {number} ymax
 */
export function forecastPoints (hours, now, t0, t1, ymax) {
  const out = []
  if (!Array.isArray(hours)) return ''
  for (let i = 0; i < hours.length; i++) {
    const h = hours[i]
    const t = toMs(h && h.t)
    if (t === undefined || typeof h.solarW !== 'number') continue
    const mid = t + HALF
    if (t <= now && now < t + HOUR) out.push([now, h.solarW])
    if (mid > now && mid <= t1) out.push([mid, h.solarW])
  }
  return out.filter((p) => p[0] >= t0).map((p) => xOf(p[0], t0, t1).toFixed(1) + ',' + yOf(p[1], ymax).toFixed(1)).join(' ')
}

/**
 * Largest forecast solar value, 0 without one.
 * @param {Array<{ solarW: number }>} hours
 */
export function forecastPeak (hours) {
  let max = 0
  if (!Array.isArray(hours)) return max
  for (let i = 0; i < hours.length; i++) if (hours[i] && typeof hours[i].solarW === 'number' && hours[i].solarW > max) max = hours[i].solarW
  return max
}
