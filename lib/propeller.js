// Learns P = k · rpmⁿ from steady motoring (SPEC 2.4, ARCHITECTURE 2.4).
// Works in motor RPM; the engine converts to shaft RPM with the gear ratio.

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

/** @typedef {[number, number, number]} Sample rpm, watts, time */

/** @param {number[]} xs */
export function median (xs) {
  if (xs.length === 0) return NaN
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Theil–Sen line fit: median of pairwise slopes, then median intercept.
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {{ slope: number, intercept: number }}
 */
export function theilSen (xs, ys) {
  const slopes = []
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const dx = xs[j] - xs[i]
      if (Math.abs(dx) > 1e-9) slopes.push((ys[j] - ys[i]) / dx)
    }
  }
  const slope = median(slopes)
  const intercept = median(xs.map((x, i) => ys[i] - slope * x))
  return { slope, intercept }
}

export class PropellerModel {
  /**
   * @param {{ fallbackK?: number, fallbackN?: number }} [opts]
   */
  constructor (opts = {}) {
    this.fallbackK = opts.fallbackK && opts.fallbackK > 0 ? opts.fallbackK : undefined
    this.fallbackN = clampN(opts.fallbackN || 3)
    /** @type {Sample[]} */
    this.samples = []
    /** @type {{ rpm: number, watts: number, t: number }[]} */
    this.window = []
    /** @type {number | undefined} */
    this.k = undefined
    this.n = this.fallbackN
    /** @type {number | undefined} */
    this.updatedAt = undefined
    /** @type {number | undefined} */
    this.lastAcceptedAt = undefined
  }

  get ready () {
    return this.samples.length >= READY_SAMPLES && this.k !== undefined
  }

  /**
   * Feed one tick. Returns true when a sample was accepted.
   * @param {number | undefined} rpm
   * @param {number | undefined} watts
   * @param {boolean} inDrive
   * @param {number} now
   */
  observe (rpm, watts, inDrive, now) {
    if (!inDrive || rpm === undefined || watts === undefined || !Number.isFinite(rpm) || !Number.isFinite(watts) || rpm <= RPM_FLOOR || watts <= 0) {
      this.window = []
      return false
    }
    this.window.push({ rpm, watts, t: now })
    while (this.window.length && now - this.window[0].t > WINDOW_MS) this.window.shift()
    if (!this.isSteady(now)) return false
    if (this.lastAcceptedAt !== undefined && now - this.lastAcceptedAt < SAMPLE_INTERVAL_MS) return false
    this.add(rpm, watts, now)
    this.lastAcceptedAt = now
    this.fit()
    return true
  }

  /** @param {number} now */
  isSteady (now) {
    const w = this.window
    if (w.length < 3 || now - w[0].t < WINDOW_MS * 0.8) return false
    const mr = w.reduce((a, s) => a + s.rpm, 0) / w.length
    const mp = w.reduce((a, s) => a + s.watts, 0) / w.length
    return w.every((s) => Math.abs(s.rpm - mr) <= mr * STEADY_TOLERANCE && Math.abs(s.watts - mp) <= mp * STEADY_TOLERANCE)
  }

  /**
   * Add a sample, keeping at most MAX_PER_BUCKET per 25 rpm bucket and
   * MAX_SAMPLES overall (oldest of the fullest bucket goes first).
   * @param {number} rpm
   * @param {number} watts
   * @param {number} now
   */
  add (rpm, watts, now) {
    this.samples.push([rpm, watts, now])
    const b = bucket(rpm)
    const inBucket = this.samples.filter((s) => bucket(s[0]) === b)
    if (inBucket.length > MAX_PER_BUCKET) this.samples.splice(this.samples.indexOf(inBucket[0]), 1)
    if (this.samples.length > MAX_SAMPLES) {
      /** @type {Map<number, Sample[]>} */
      const groups = new Map()
      for (const s of this.samples) {
        const g = groups.get(bucket(s[0])) || []
        g.push(s)
        groups.set(bucket(s[0]), g)
      }
      let fullest = /** @type {Sample[]} */ ([])
      for (const g of groups.values()) if (g.length > fullest.length) fullest = g
      this.samples.splice(this.samples.indexOf(fullest[0]), 1)
    }
  }

  /** Refit k (and n when the RPM spread allows) from the samples. */
  fit () {
    if (this.samples.length === 0) return
    const rpms = this.samples.map((s) => s[0])
    const buckets = new Set(rpms.map(bucket)).size
    const spread = Math.max(...rpms) / Math.min(...rpms)
    let n = this.fallbackN
    let k
    if (buckets >= MIN_BUCKETS_FOR_N && spread >= MIN_RPM_RATIO_FOR_N) {
      const xs = rpms.map(Math.log)
      const ys = this.samples.map((s) => Math.log(s[1]))
      const line = theilSen(xs, ys)
      if (Number.isFinite(line.slope)) {
        n = clampN(line.slope)
        k = Math.exp(median(xs.map((x, i) => ys[i] - n * x)))
      }
    }
    if (k === undefined) k = median(this.samples.map((s) => s[1] / Math.pow(s[0], n)))
    if (Number.isFinite(k) && k > 0) {
      this.k = k
      this.n = n
      this.updatedAt = this.samples[this.samples.length - 1][2]
    }
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

  reset () {
    this.samples = []
    this.window = []
    this.k = undefined
    this.n = this.fallbackN
    this.updatedAt = undefined
    this.lastAcceptedAt = undefined
  }

  toJSON () {
    return { k: this.k, n: this.n, samples: this.samples.slice(), updatedAt: this.updatedAt }
  }

  /**
   * Restore saved samples; invalid entries are dropped and the model refitted.
   * @param {unknown} data
   */
  load (data) {
    this.reset()
    if (!data || typeof data !== 'object' || !Array.isArray(/** @type {any} */ (data).samples)) return
    for (const s of /** @type {any[]} */ (/** @type {any} */ (data).samples)) {
      if (Array.isArray(s) && s.length === 3 && s.every(Number.isFinite) && s[0] > 0 && s[1] > 0) {
        this.samples.push([s[0], s[1], s[2]])
      }
    }
    this.samples = this.samples.slice(-MAX_SAMPLES)
    this.fit()
  }
}

/** @param {number} rpm */
function bucket (rpm) {
  return Math.floor(rpm / BUCKET_RPM)
}

/** @param {number} n */
function clampN (n) {
  return Math.min(N_MAX, Math.max(N_MIN, n))
}
