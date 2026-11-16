// Range and waypoint ETAs at the solar budget (plan 11). Pure: takes the
// speed model's parameters, the budgets, sunset and course distances.
// Distances come from course-provider (along the route, over ground); the
// speed is through the water. The next waypoint is corrected for the
// current measured now (lib/current.js); the final destination of a route is
// not, because the current changes along a longer route.

import { components, speedMadeGood, stwNeeded } from './current.js'

/** The inverse power law is not trusted this far outside the learned power range. */
export const POWER_RANGE_SLACK = 0.5

/**
 * @typedef {{ c: number, m: number, minPowerW?: number, maxPowerW?: number }} SpeedParams
 * @typedef {import('./types.js').CourseReading} CourseReading
 * @typedef {import('./types.js').TargetEstimate} TargetEstimate
 * @typedef {import('./types.js').RangeBasis} RangeBasis
 * @typedef {import('./types.js').CurrentEstimate} CurrentEstimate
 */

/**
 * Motor power that gives `mps` through the water, or undefined when the
 * answer lies more than 50 % outside the learned power range.
 * @param {SpeedParams} p
 * @param {number} mps
 */
export function powerFor (p, mps) {
  if (!(mps > 0) || !(p.c > 0) || !(p.m > 0)) return undefined
  const w = Math.pow(mps / p.c, 1 / p.m)
  if (!Number.isFinite(w)) return undefined
  if (p.minPowerW !== undefined && w < p.minPowerW * (1 - POWER_RANGE_SLACK)) return undefined
  if (p.maxPowerW !== undefined && w > p.maxPowerW * (1 + POWER_RANGE_SLACK)) return undefined
  return w
}

/**
 * ETA and required power for one target. With `current` (along and across
 * the bearing to the target), the ETA uses the speed made good and the
 * required power the speed through the water that makes good the distance
 * by sunset while holding the line against the cross-track part.
 * @param {number | undefined} distanceM
 * @param {SpeedParams} p
 * @param {number | undefined} speed m/s through the water at the basis budget
 * @param {number | undefined} sunset
 * @param {number} now
 * @param {{ along: number, across: number }} [current]
 * @returns {TargetEstimate | undefined}
 */
export function targetEstimate (distanceM, p, speed, sunset, now, current) {
  if (distanceM === undefined || !Number.isFinite(distanceM) || distanceM < 0) return undefined
  /** @type {TargetEstimate} */
  const out = { distanceM, currentCorrected: Boolean(current) }
  if (current) {
    out.currentAlongMps = current.along
    out.currentAcrossMps = current.across
  }
  if (speed !== undefined && speed > 0) {
    const made = current ? speedMadeGood(speed, current) : speed
    if (made > 0) {
      out.eta = now + (distanceM / made) * 1000
      if (sunset !== undefined) out.afterSunset = out.eta > sunset
    }
  }
  if (sunset !== undefined && sunset > now) {
    const vmg = distanceM / ((sunset - now) / 1000)
    const stw = current ? stwNeeded(vmg, current) : vmg
    // The current alone gets the boat there in time.
    out.requiredPowerW = current && stw === 0 ? 0 : powerFor(p, stw)
  }
  return out
}

/**
 * @param {{ params?: SpeedParams, budgetW?: number, dayBudgetW?: number,
 *    sunset?: number, course?: CourseReading, current?: CurrentEstimate,
 *    now: number }} input
 * @returns {{ rangeBasis?: RangeBasis, speedAtBudget?: number,
 *    rangeUntilSunsetM?: number, waypoint?: TargetEstimate,
 *    destination?: TargetEstimate }}
 */
export function rangeEstimate ({ params, budgetW, dayBudgetW, sunset, course, current, now }) {
  if (!params) return {}
  /** @type {RangeBasis | undefined} */
  const basis = dayBudgetW !== undefined ? 'dayBudget' : (budgetW !== undefined ? 'budget' : undefined)
  const basisW = basis === 'dayBudget' ? dayBudgetW : budgetW
  const speed = basisW !== undefined && basisW > 0 ? params.c * Math.pow(basisW, params.m) : undefined
  /** @type {ReturnType<typeof rangeEstimate>} */
  const out = {}
  if (speed !== undefined && Number.isFinite(speed)) {
    out.rangeBasis = basis
    out.speedAtBudget = speed
    if (sunset !== undefined && sunset > now) out.rangeUntilSunsetM = speed * (sunset - now) / 1000
  }
  const live = course && !course.stale ? course : undefined
  if (live && live.nextM !== undefined) {
    const c = current && live.bearingTrue !== undefined ? components(current, live.bearingTrue) : undefined
    out.waypoint = targetEstimate(live.nextM, params, out.speedAtBudget, sunset, now, c)
    // A single-point course: the destination is the next waypoint, same leg.
    out.destination = live.routeM !== undefined
      ? targetEstimate(live.routeM, params, out.speedAtBudget, sunset, now)
      : out.waypoint
  }
  return out
}
