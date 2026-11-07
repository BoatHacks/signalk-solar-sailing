// Energy since local midnight, in joules (SPEC 5.1, ARCHITECTURE 2.5).
// Local midnight comes from the ship's timezone offset, never the server TZ.

/**
 * Calendar day at the given offset, e.g. "2026-11-07".
 * @param {number} ms
 * @param {number} [offsetMin] minutes east of UTC; undefined = UTC
 */
export function dayKey (ms, offsetMin) {
  return new Date(ms + (offsetMin || 0) * 60000).toISOString().slice(0, 10)
}

/**
 * Epoch ms of the most recent local midnight.
 * @param {number} ms
 * @param {number} [offsetMin]
 */
export function localMidnight (ms, offsetMin) {
  const shift = (offsetMin || 0) * 60000
  const local = ms + shift
  return local - (((local % 86400000) + 86400000) % 86400000) - shift
}

export class EnergyCounter {
  constructor () {
    this.joules = 0
    /** @type {number | undefined} */
    this.lastW = undefined
    /** @type {number | undefined} */
    this.lastAt = undefined
    /** @type {string | undefined} */
    this.day = undefined
  }

  /**
   * @param {number} [now]
   * @param {number} [offsetMin]
   */
  reset (now, offsetMin) {
    this.joules = 0
    this.lastW = undefined
    this.lastAt = undefined
    this.day = now === undefined ? undefined : dayKey(now, offsetMin)
  }

  /**
   * Continue from a value recorded earlier today (History API seed).
   * @param {number} joules
   * @param {number} now
   * @param {number} [offsetMin]
   */
  seed (joules, now, offsetMin) {
    const day = dayKey(now, offsetMin)
    if (this.day !== undefined && this.day !== day) this.reset(now, offsetMin)
    this.day = day
    if (Number.isFinite(joules) && joules > this.joules) this.joules = joules
  }

  /**
   * Trapezoidal integration. Gaps longer than maxGapS are not integrated, so
   * a server restart or data dropout doesn't invent energy.
   * @param {number | undefined} watts
   * @param {number} now
   * @param {number} [offsetMin]
   * @param {number} [maxGapS]
   */
  add (watts, now, offsetMin, maxGapS = 30) {
    const day = dayKey(now, offsetMin)
    if (this.day !== day) this.reset(now, offsetMin)
    const w = watts !== undefined && Number.isFinite(watts) ? watts : undefined
    if (w !== undefined && this.lastAt !== undefined && this.lastW !== undefined) {
      const dt = (now - this.lastAt) / 1000
      if (dt > 0 && dt <= maxGapS) this.joules += ((w + this.lastW) / 2) * dt
    }
    this.lastW = w
    this.lastAt = now
    return this.joules
  }
}
