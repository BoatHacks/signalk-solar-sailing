// Set and drift of the current (plan 11, "Current"). Pure, no I/O.
// Either taken as published (`environment.current`, e.g. from
// signalk-derived-data) or estimated here as ground velocity minus water
// velocity, averaged over a few minutes. Leeway ends up in the estimate as
// cross-track current, which is what it does to the track anyway.

/** Averaging time constant of the own estimate. */
export const CURRENT_TAU_MS = 5 * 60000
/** The own estimate needs this much data before it is used. */
export const CURRENT_MIN_MS = 60000
/** Gaps longer than this restart the average; older estimates are dropped. */
export const CURRENT_MAX_GAP_MS = 120000
/** Below this STW the heading says little about the water track. */
export const CURRENT_STW_FLOOR = 0.3

/** @typedef {import('./types.js').CurrentEstimate} CurrentEstimate */

/**
 * North/east components of a speed along a direction.
 * @param {number} speed m/s
 * @param {number} dir rad, true
 */
export function toVector (speed, dir) {
  return { n: speed * Math.cos(dir), e: speed * Math.sin(dir) }
}

/**
 * @param {number} n
 * @param {number} e
 * @returns {{ setTrue: number, drift: number }}
 */
export function fromVector (n, e) {
  const turn = 2 * Math.PI
  return { setTrue: ((Math.atan2(e, n) % turn) + turn) % turn, drift: Math.hypot(n, e) }
}

/**
 * Current split along and across a bearing.
 * @param {{ setTrue: number, drift: number }} c
 * @param {number} bearing rad, true
 * @returns {{ along: number, across: number }} along > 0 helps, m/s
 */
export function components (c, bearing) {
  const a = c.setTrue - bearing
  return { along: c.drift * Math.cos(a), across: c.drift * Math.sin(a) }
}

/** Exponentially averaged ground − water velocity. */
export class CurrentEstimator {
  constructor () {
    /** @type {{ n: number, e: number } | undefined} */
    this.avg = undefined
    /** @type {number | undefined} */
    this.since = undefined
    /** @type {number | undefined} */
    this.lastAt = undefined
  }

  /**
   * @param {{ stw?: number, heading?: number, sog?: number, cog?: number }} v
   *    STW (corrected) and heading true, SOG and COG true; fresh values only
   * @param {number} now
   */
  observe (v, now) {
    const { stw, heading, sog, cog } = v
    if (stw === undefined || heading === undefined || sog === undefined || cog === undefined) return false
    if (![stw, heading, sog, cog].every(Number.isFinite) || stw <= CURRENT_STW_FLOOR || sog < 0) return false
    const g = toVector(sog, cog)
    const w = toVector(stw, heading)
    const x = { n: g.n - w.n, e: g.e - w.e }
    if (!this.avg || this.lastAt === undefined || now - this.lastAt > CURRENT_MAX_GAP_MS) {
      this.avg = x
      this.since = now
    } else {
      const a = 1 - Math.exp(-(now - this.lastAt) / CURRENT_TAU_MS)
      this.avg = { n: this.avg.n + a * (x.n - this.avg.n), e: this.avg.e + a * (x.e - this.avg.e) }
    }
    this.lastAt = now
    return true
  }

  /**
   * The averaged current, once it covers CURRENT_MIN_MS and is recent.
   * @param {number} now
   * @returns {CurrentEstimate | undefined}
   */
  value (now) {
    if (!this.avg || this.since === undefined || this.lastAt === undefined) return undefined
    if (this.lastAt - this.since < CURRENT_MIN_MS || now - this.lastAt > CURRENT_MAX_GAP_MS) return undefined
    return { ...fromVector(this.avg.n, this.avg.e), source: 'estimated' }
  }
}

/**
 * Speed through the water needed to make good `vmg` along a bearing with a
 * current: the water track has to cancel the cross-track part.
 * @param {number} vmg m/s over ground along the bearing
 * @param {{ along: number, across: number }} c
 */
export function stwNeeded (vmg, c) {
  return Math.hypot(Math.max(0, vmg - c.along), c.across)
}

/**
 * Speed made good along a bearing at a given speed through the water, or 0
 * when the boat cannot hold the line or the current sets it back.
 * @param {number} stw m/s
 * @param {{ along: number, across: number }} c
 */
export function speedMadeGood (stw, c) {
  if (stw <= Math.abs(c.across)) return 0
  return Math.max(0, Math.sqrt(stw * stw - c.across * c.across) + c.along)
}
