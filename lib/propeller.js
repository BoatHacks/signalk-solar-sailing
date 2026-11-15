// Learns P = k · rpmⁿ from steady motoring (SPEC 2.4, ARCHITECTURE 2.4).
// Works in motor RPM; the engine converts to shaft RPM with the gear ratio.
// The fitting itself lives in powerlaw.js, shared with the speed model.

import { PowerLawLearner, median, theilSen } from './powerlaw.js'

export const WINDOW_MS = 10000
export const STEADY_TOLERANCE = 0.05
export const RPM_FLOOR = 200
export const BUCKET_RPM = 25
export const MAX_SAMPLES = 300
export const MAX_PER_BUCKET = 30
export const READY_SAMPLES = 30
export const MIN_BUCKETS_FOR_N = 4
export const MIN_RPM_RATIO_FOR_N = 1.5
export const N_MIN = 1
export const N_MAX = 3.5
/** Minimum time between two accepted samples, so one steady stretch can't flood a bucket. */
export const SAMPLE_INTERVAL_MS = 5000

export { median, theilSen }

export class PropellerModel extends PowerLawLearner {
  /**
   * @param {{ fallbackK?: number, fallbackN?: number }} [opts]
   */
  constructor (opts = {}) {
    super({
      fallbackExp: opts.fallbackN || 3,
      expMin: N_MIN,
      expMax: N_MAX,
      bucket: (rpm) => Math.floor(rpm / BUCKET_RPM),
      xFloor: RPM_FLOOR,
      yFloor: 0,
      xTol: (mean) => mean * STEADY_TOLERANCE,
      yTol: (mean) => mean * STEADY_TOLERANCE,
      minBuckets: MIN_BUCKETS_FOR_N,
      minRatio: MIN_RPM_RATIO_FOR_N,
      windowMs: WINDOW_MS,
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
      maxSamples: MAX_SAMPLES,
      maxPerBucket: MAX_PER_BUCKET,
      readySamples: READY_SAMPLES
    })
    this.fallbackK = opts.fallbackK && opts.fallbackK > 0 ? opts.fallbackK : undefined
  }

  /** Learned k of P = k · rpmⁿ. */
  get k () {
    return this.coef
  }

  /** Exponent n (fallback until fitted). */
  get n () {
    return this.exp
  }

  get fallbackN () {
    return this.fallbackExp
  }

  /**
   * Motor RPM that draws `budgetW`, or undefined while neither the learned
   * model nor a configured fallback k is available.
   * @param {number | undefined} budgetW
   */
  targetRpm (budgetW) {
    if (budgetW === undefined || !Number.isFinite(budgetW)) return undefined
    const k = this.ready ? this.k : this.fallbackK
    const n = this.ready ? this.n : this.fallbackN
    if (k === undefined || !(k > 0)) return undefined
    return Math.pow(Math.max(0, budgetW) / k, 1 / n)
  }

  toJSON () {
    return { k: this.k, n: this.n, samples: this.samples.slice(), updatedAt: this.updatedAt }
  }

  /**
   * Restore saved samples; invalid entries are dropped and the model refitted.
   * @param {unknown} data
   */
  load (data) {
    this.loadSamples(data && typeof data === 'object' ? /** @type {any} */ (data).samples : undefined)
  }
}
