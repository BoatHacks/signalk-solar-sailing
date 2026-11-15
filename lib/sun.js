// Sunrise and sunset at a position (plan 9 "Sunset", plan 10). Pure maths,
// no dependencies: the NOAA / sunrise-equation approximation with the
// standard −0.833° horizon (refraction plus the sun's radius). Accurate to
// about a minute away from the polar circles, which is plenty for a budget.

import { localMidnight } from './energy.js'

const DAY_MS = 86400000
const J2000 = 2451545
const RAD = Math.PI / 180
const HORIZON = -0.833 * RAD
const OBLIQUITY = 23.4397 * RAD

/** @param {number} ms */
const toJulian = (ms) => ms / DAY_MS + 2440587.5
/** @param {number} j */
const fromJulian = (j) => Math.round((j - 2440587.5) * DAY_MS)

/**
 * Epoch ms of the most recent local midnight in ship time (same day boundary
 * as the energy counters).
 * @param {number} now
 * @param {number} [tzOffsetMin] minutes east of UTC; undefined = UTC
 */
export function dayStart (now, tzOffsetMin) {
  return localMidnight(now, tzOffsetMin)
}

/**
 * @typedef {{ sunrise?: number, sunset?: number, transit: number,
 *    alwaysUp: boolean, alwaysDown: boolean }} SunTimes
 */

/**
 * Sunrise and sunset around the solar noon nearest to the middle of the local
 * day that starts at `dayStartMs`.
 * @param {number} lat degrees, north positive
 * @param {number} lon degrees, east positive
 * @param {number} dayStartMs epoch ms of local midnight
 * @returns {SunTimes}
 */
export function sunTimes (lat, lon, dayStartMs) {
  const noon = toJulian(dayStartMs + DAY_MS / 2)
  // Day number whose solar transit is nearest to local noon.
  const n = Math.round(noon - J2000 - 0.0008 + lon / 360)
  const jStar = n - lon / 360
  const m = ((357.5291 + 0.98560028 * jStar) % 360) * RAD
  const c = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)
  const lambda = ((m / RAD + c + 180 + 102.9372) % 360) * RAD
  const transit = J2000 + jStar + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * lambda)
  const sinDecl = Math.sin(lambda) * Math.sin(OBLIQUITY)
  const cosDecl = Math.cos(Math.asin(sinDecl))
  const phi = lat * RAD
  const cosW = (Math.sin(HORIZON) - Math.sin(phi) * sinDecl) / (Math.cos(phi) * cosDecl)
  const t = fromJulian(transit)
  if (cosW < -1) return { transit: t, alwaysUp: true, alwaysDown: false }
  if (cosW > 1) return { transit: t, alwaysUp: false, alwaysDown: true }
  const w = Math.acos(cosW) / RAD / 360
  return {
    sunrise: fromJulian(transit - w),
    sunset: fromJulian(transit + w),
    transit: t,
    alwaysUp: false,
    alwaysDown: false
  }
}
