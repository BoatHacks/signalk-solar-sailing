// Learns y = coef · xᵉˣᵖ from steady samples (SPEC 2.4, ARCHITECTURE 2.4).
// Shared by the propeller model (watts against RPM) and the speed model
// (speed through water against watts). Pure, no I/O.

/** @typedef {[number, number, number]} Sample x, y, time */

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

/**
 * @typedef {Object} LearnerOptions
 * @property {number} fallbackExp exponent until the samples span enough range
 * @property {number} expMin
 * @property {number} expMax
 * @property {(x: number) => number} bucket bucket key of an x value
 * @property {number} xFloor samples need x above this
 * @property {number} yFloor samples need y above this
 * @property {(mean: number) => number} xTol allowed deviation from the window mean
 * @property {(mean: number) => number} yTol
 * @property {number} minBuckets buckets needed to fit the exponent
 * @property {number} minRatio max/min x ratio needed to fit the exponent
 * @property {number} [windowMs] steady window, default 10 s
 * @property {number} [sampleIntervalMs] minimum time between accepted samples, default 5 s
 * @property {number} [maxSamples] default 300
 * @property {number} [maxPerBucket] default 30
 * @property {number} [readySamples] default 30
 */

export class PowerLawLearner {
  /** @param {LearnerOptions} opts */
  constructor (opts) {
    this.opts = {
      windowMs: 10000,
      sampleIntervalMs: 5000,
      maxSamples: 300,
      maxPerBucket: 30,
      readySamples: 30,
      ...opts
    }
    this.fallbackExp = this.clampExp(opts.fallbackExp)
    /** Factor applied to y at fit time; samples stay raw. */
    this.yScale = 1
    /** @type {Sample[]} */
    this.samples = []
    /** @type {{ x: number, y: number, t: number }[]} */
    this.window = []
    /** @type {number | undefined} */
    this.coef = undefined
    this.exp = this.fallbackExp
    /** @type {number | undefined} */
    this.updatedAt = undefined
    /** @type {number | undefined} */
    this.lastAcceptedAt = undefined
  }

  get ready () {
    return this.samples.length >= this.opts.readySamples && this.coef !== undefined
  }

  /** @param {number} e */
  clampExp (e) {
    return Math.min(this.opts.expMax, Math.max(this.opts.expMin, e))
  }

  /**
   * Feed one tick. Returns true when a sample was accepted.
   * @param {number | undefined} x
   * @param {number | undefined} y
   * @param {boolean} ok caller's gate (in drive, not sailing, …)
   * @param {number} now
   */
  observe (x, y, ok, now) {
    if (!ok || x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y) || x <= this.opts.xFloor || y <= this.opts.yFloor) {
      this.window = []
      return false
    }
    this.window.push({ x, y, t: now })
    while (this.window.length && now - this.window[0].t > this.opts.windowMs) this.window.shift()
    if (!this.isSteady(now)) return false
    if (this.lastAcceptedAt !== undefined && now - this.lastAcceptedAt < this.opts.sampleIntervalMs) return false
    this.add(x, y, now)
    this.lastAcceptedAt = now
    this.fit()
    return true
  }

  /**
   * Both values within tolerance of their mean over a nearly full window.
   * @param {number} now
   */
  isSteady (now) {
    const w = this.window
    if (w.length < 3 || now - w[0].t < this.opts.windowMs * 0.8) return false
    const mx = w.reduce((a, s) => a + s.x, 0) / w.length
    const my = w.reduce((a, s) => a + s.y, 0) / w.length
    const tx = this.opts.xTol(mx)
    const ty = this.opts.yTol(my)
    return w.every((s) => Math.abs(s.x - mx) <= tx && Math.abs(s.y - my) <= ty)
  }

  /**
   * Add a sample, keeping at most maxPerBucket per bucket and maxSamples
   * overall (oldest of the fullest bucket goes first).
   * @param {number} x
   * @param {number} y
   * @param {number} now
   */
  add (x, y, now) {
    const { bucket, maxPerBucket, maxSamples } = this.opts
    this.samples.push([x, y, now])
    const b = bucket(x)
    const inBucket = this.samples.filter((s) => bucket(s[0]) === b)
    if (inBucket.length > maxPerBucket) this.samples.splice(this.samples.indexOf(inBucket[0]), 1)
    if (this.samples.length > maxSamples) {
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

  /** Refit coef (and the exponent when the x spread allows) from the samples. */
  fit () {
    if (this.samples.length === 0) return
    const xs0 = this.samples.map((s) => s[0])
    const ys0 = this.samples.map((s) => s[1] * this.yScale)
    const buckets = new Set(xs0.map(this.opts.bucket)).size
    const spread = Math.max(...xs0) / Math.min(...xs0)
    let e = this.fallbackExp
    let coef
    if (buckets >= this.opts.minBuckets && spread >= this.opts.minRatio) {
      const xs = xs0.map(Math.log)
      const ys = ys0.map(Math.log)
      const line = theilSen(xs, ys)
      if (Number.isFinite(line.slope)) {
        e = this.clampExp(line.slope)
        coef = Math.exp(median(xs.map((x, i) => ys[i] - e * x)))
      }
    }
    if (coef === undefined) coef = median(xs0.map((x, i) => ys0[i] / Math.pow(x, e)))
    if (Number.isFinite(coef) && coef > 0) {
      this.coef = coef
      this.exp = e
      this.updatedAt = this.samples[this.samples.length - 1][2]
    }
  }

  /** Smallest and largest x in the samples, or undefined without samples. */
  xRange () {
    if (this.samples.length === 0) return undefined
    const xs = this.samples.map((s) => s[0])
    return { min: Math.min(...xs), max: Math.max(...xs) }
  }

  reset () {
    this.samples = []
    this.window = []
    this.coef = undefined
    this.exp = this.fallbackExp
    this.updatedAt = undefined
    this.lastAcceptedAt = undefined
  }

  /**
   * Restore saved samples; invalid entries are dropped and the model refitted.
   * @param {unknown} samples
   */
  loadSamples (samples) {
    this.reset()
    if (!Array.isArray(samples)) return
    for (const s of samples) {
      if (Array.isArray(s) && s.length === 3 && s.every(Number.isFinite) && s[0] > 0 && s[1] > 0) {
        this.samples.push([s[0], s[1], s[2]])
      }
    }
    this.samples = this.samples.slice(-this.opts.maxSamples)
    this.fit()
  }
}
