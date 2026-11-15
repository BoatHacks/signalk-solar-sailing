// Learns speed through water against motor power, v = c · Pᵐ (plan 11).
// A displacement hull at low speed follows roughly P ∝ v³, so m starts at ⅓.
// Also suggests an STW correction factor from SOG/STW over several headings
// (never applied automatically). Pure, no I/O.

import { PowerLawLearner, median } from './powerlaw.js'

export const STW_FLOOR = 0.3
export const STEADY_TOLERANCE = 0.05
/** Small speeds make 5 % meaningless; STW may always move this much. */
export const STW_TOLERANCE_MPS = 0.1
/** Logarithmic power buckets, 10 % wide. */
export const BUCKET_RATIO = 1.1
export const MIN_BUCKETS_FOR_M = 4
export const MIN_POWER_RATIO_FOR_M = 2
export const M_MIN = 0.15
export const M_MAX = 0.6
export const M_DEFAULT = 1 / 3
export const READY_SAMPLES = 30

/** STW factor suggestion: heading sectors, samples per sector, sectors needed. */
export const SECTORS = 8
export const SECTOR_MIN_SAMPLES = 10
export const SECTOR_MAX_SAMPLES = 30
export const SECTORS_NEEDED = 4
export const RATIO_INTERVAL_MS = 5000

/** @param {number} watts */
const powerBucket = (watts) => Math.floor(Math.log(watts) / Math.log(BUCKET_RATIO))

export class SpeedModel extends PowerLawLearner {
  /**
   * @param {{ fallbackC?: number, fallbackM?: number, stwFactor?: number }} [opts]
   */
  constructor (opts = {}) {
    super({
      fallbackExp: opts.fallbackM && opts.fallbackM > 0 ? opts.fallbackM : M_DEFAULT,
      expMin: M_MIN,
      expMax: M_MAX,
      bucket: powerBucket,
      xFloor: 0,
      yFloor: STW_FLOOR,
      xTol: (mean) => mean * STEADY_TOLERANCE,
      yTol: (mean) => Math.max(mean * STEADY_TOLERANCE, STW_TOLERANCE_MPS),
      minBuckets: MIN_BUCKETS_FOR_M,
      minRatio: MIN_POWER_RATIO_FOR_M,
      readySamples: READY_SAMPLES
    })
    this.fallbackC = opts.fallbackC && opts.fallbackC > 0 ? opts.fallbackC : undefined
    this.yScale = opts.stwFactor && opts.stwFactor > 0 ? opts.stwFactor : 1
    this.ratios = new StwRatios()
  }

  /** The learned c, m when ready, else the configured fallback, else undefined. */
  params () {
    if (this.ready && this.coef !== undefined) {
      const r = this.xRange()
      return { c: this.coef, m: this.exp, learned: true, minPowerW: r && r.min, maxPowerW: r && r.max }
    }
    if (this.fallbackC !== undefined) return { c: this.fallbackC, m: this.fallbackExp, learned: false, minPowerW: undefined, maxPowerW: undefined }
    return undefined
  }

  /**
   * Speed through water (m/s, corrected) at a motor power, or undefined.
   * @param {number | undefined} watts
   */
  speedAt (watts) {
    const p = this.params()
    if (!p || watts === undefined || !Number.isFinite(watts) || watts <= 0) return undefined
    return p.c * Math.pow(watts, p.m)
  }

  /** Clears the samples and the SOG/STW ratios. */
  reset () {
    super.reset()
    this.ratios = new StwRatios()
  }

  toJSON () {
    return {
      c: this.coef,
      m: this.exp,
      samples: this.samples.slice(),
      updatedAt: this.updatedAt,
      stwRatios: this.ratios.toJSON()
    }
  }

  /**
   * Restore saved samples and ratios; invalid entries are dropped and the
   * model refitted with the current STW factor.
   * @param {unknown} data
   */
  load (data) {
    const d = data && typeof data === 'object' ? /** @type {any} */ (data) : {}
    this.loadSamples(d.samples)
    this.ratios.load(d.stwRatios)
  }
}

/**
 * SOG / STW ratios by course-over-ground sector. Current adds to SOG on one
 * heading and takes it away on the opposite one, so the median over several
 * sectors approaches the log's calibration error.
 */
export class StwRatios {
  constructor () {
    /** @type {number[][]} */
    this.sectors = Array.from({ length: SECTORS }, () => [])
    /** @type {number | undefined} */
    this.lastAt = undefined
  }

  /**
   * @param {number | undefined} stw raw STW, m/s
   * @param {number | undefined} sog m/s
   * @param {number | undefined} cog rad
   * @param {boolean} ok caller's gate (motoring, all three fresh)
   * @param {number} now
   */
  observe (stw, sog, cog, ok, now) {
    if (!ok || stw === undefined || sog === undefined || cog === undefined) return false
    if (![stw, sog, cog].every(Number.isFinite) || stw <= STW_FLOOR || sog <= 0) return false
    if (this.lastAt !== undefined && now - this.lastAt < RATIO_INTERVAL_MS) return false
    const turn = 2 * Math.PI
    const sector = Math.floor((((cog % turn) + turn) % turn) / (turn / SECTORS)) % SECTORS
    const list = this.sectors[sector]
    list.push(sog / stw)
    if (list.length > SECTOR_MAX_SAMPLES) list.shift()
    this.lastAt = now
    return true
  }

  /**
   * Suggested STW factor once enough sectors are covered: the median of the
   * per-sector medians, with the spread (max − min) of those medians.
   * @returns {{ factor: number, spread: number, sectors: number } | undefined}
   */
  suggestion () {
    const meds = this.sectors.filter((l) => l.length >= SECTOR_MIN_SAMPLES).map(median)
    if (meds.length < SECTORS_NEEDED) return undefined
    return { factor: median(meds), spread: Math.max(...meds) - Math.min(...meds), sectors: meds.length }
  }

  toJSON () {
    return this.sectors.map((l) => l.slice())
  }

  /** @param {unknown} data */
  load (data) {
    if (!Array.isArray(data)) return
    for (let i = 0; i < SECTORS && i < data.length; i++) {
      const l = data[i]
      if (Array.isArray(l)) this.sectors[i] = l.filter((v) => Number.isFinite(v) && v > 0).slice(-SECTOR_MAX_SAMPLES)
    }
  }
}
