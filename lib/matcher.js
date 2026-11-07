// The solar-matching maths: pure functions plus a small stateful smoother.
// `recommend`, `rampLimit` and `shouldSend` from the draft belong to the
// post-MVP put output (ARCHITECTURE 2.7) and are added with it.

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * Exponential moving average with a time constant in seconds. Clouds make
 * solar input jumpy; the budget should not chase every shadow.
 */
export class Smoother {
  /** @param {number} tauSeconds */
  constructor (tauSeconds) {
    this.tau = Math.max(0, tauSeconds || 0)
    /** @type {number | undefined} */
    this.value = undefined
    /** @type {number | undefined} */
    this.lastAt = undefined
  }

  /**
   * @param {number | undefined} x
   * @param {number} nowMs
   * @returns {number | undefined}
   */
  update (x, nowMs) {
    if (x === undefined || !Number.isFinite(x)) return this.value
    if (this.value === undefined || this.tau === 0 || this.lastAt === undefined) {
      this.value = x
    } else {
      const dt = Math.max(0, (nowMs - this.lastAt) / 1000)
      const alpha = 1 - Math.exp(-dt / this.tau)
      this.value += alpha * (x - this.value)
    }
    this.lastAt = nowMs
    return this.value
  }

  reset () {
    this.value = undefined
    this.lastAt = undefined
  }
}

/**
 * SoC bias (SPEC 2.2): below socLow hold back chargeReserveW so the bank still
 * charges; above socHigh allow the battery to add batteryAssistW. Linear in
 * between. Unknown SoC gives no bias.
 * @param {number | undefined} socPercent
 * @param {{ socLow: number, socHigh: number, chargeReserveW: number, batteryAssistW: number }} opts
 */
export function batteryBias (socPercent, opts) {
  if (socPercent === undefined || !Number.isFinite(socPercent)) return 0
  const { socLow, socHigh, chargeReserveW, batteryAssistW } = opts
  if (socPercent <= socLow) return -chargeReserveW
  if (socPercent >= socHigh) return batteryAssistW
  const f = (socPercent - socLow) / (socHigh - socLow)
  return -chargeReserveW + f * (chargeReserveW + batteryAssistW)
}

/**
 * Match state (SPEC 2.3) with tolerance max(50 W, 10 % of the budget).
 * @param {number | undefined} motorW
 * @param {number | undefined} budgetW
 * @param {number} [tolerance]
 * @returns {import('./types.js').MatchState}
 */
export function verdict (motorW, budgetW, tolerance = 0.1) {
  if (motorW === undefined || budgetW === undefined || !Number.isFinite(motorW) || !Number.isFinite(budgetW)) return 'unknown'
  const margin = Math.max(50, budgetW * tolerance)
  if (motorW > budgetW + margin) return 'over'
  if (motorW < budgetW - margin) return 'under'
  return 'matched'
}
