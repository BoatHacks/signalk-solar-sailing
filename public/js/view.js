// Pure view helpers for the elements: breakdown rows and chart geometry.
// Kept free of the DOM so they run in Node tests. ES2017.

import { withPrefix, round3 } from './units.js'

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
  const p = status.propeller
  if (p) {
    rows.push(['prop', 'Propeller model', p.ready ? 'P = k·rpm^' + round3(p.n) : 'learning (' + p.samples + ' samples)', !p.ready])
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

