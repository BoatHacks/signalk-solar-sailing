// Seeds today's energy counters from the server's History API on start
// (SPEC 7, ARCHITECTURE 2.5). One request per start, never on the tick.

import { localMidnight } from './energy.js'

export const SOLAR_ENERGY_PATH = 'plugin.solarsailing.solarEnergyToday'
export const MOTOR_ENERGY_PATH = 'plugin.solarsailing.motorEnergyToday'

/**
 * The History API takes Temporal.Instant values. Node has no global Temporal
 * before 26, and the plugin ships no polyfill, so fall back to a minimal
 * instant-like object (epochMilliseconds, toString/toJSON as ISO).
 * @param {number} ms
 */
export function toInstant (ms) {
  const T = /** @type {any} */ (globalThis).Temporal
  if (T && T.Instant && typeof T.Instant.fromEpochMilliseconds === 'function') return T.Instant.fromEpochMilliseconds(ms)
  const iso = new Date(ms).toISOString()
  return {
    epochMilliseconds: ms,
    epochNanoseconds: BigInt(ms) * 1000000n,
    toString: () => iso,
    toJSON: () => iso
  }
}

/**
 * @param {unknown} ts
 * @returns {number | undefined}
 */
function rowTime (ts) {
  if (typeof ts === 'number') return ts
  if (typeof ts === 'string') {
    const t = Date.parse(ts)
    return Number.isNaN(t) ? undefined : t
  }
  return undefined
}

/**
 * Pull the last finite value per column out of a ValuesResponse, keeping
 * only rows from today (at or after local midnight).
 * @param {any} response
 * @param {number} midnight
 * @returns {{ solarJ?: number, motorJ?: number }}
 */
export function parseSeed (response, midnight) {
  /** @type {{ solarJ?: number, motorJ?: number }} */
  const out = {}
  if (!response || !Array.isArray(response.values) || !Array.isArray(response.data)) return out
  /** @type {string[]} */
  const paths = response.values.map((/** @type {any} */ v) => (v && v.path) || '')
  const cols = { solarJ: paths.indexOf(SOLAR_ENERGY_PATH), motorJ: paths.indexOf(MOTOR_ENERGY_PATH) }
  for (const row of response.data) {
    if (!Array.isArray(row)) continue
    const t = rowTime(row[0])
    if (t === undefined || t < midnight) continue
    for (const [key, col] of /** @type {[('solarJ'|'motorJ'), number][]} */ (Object.entries(cols))) {
      if (col < 0) continue
      const v = row[col + 1]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v
    }
  }
  return out
}

/**
 * Ask the History API for today's last energy values. Any failure, a missing
 * API or no data yields `{}` so the counters start from 0.
 * @param {(() => Promise<any>) | undefined} getHistoryApi
 * @param {number} now
 * @param {number} [offsetMin]
 * @returns {Promise<{ solarJ?: number, motorJ?: number }>}
 */
export async function loadEnergySeed (getHistoryApi, now, offsetMin) {
  if (typeof getHistoryApi !== 'function') return {}
  try {
    const api = await getHistoryApi()
    if (!api || typeof api.getValues !== 'function') return {}
    const midnight = localMidnight(now, offsetMin)
    const response = await api.getValues({
      from: toInstant(midnight),
      to: toInstant(now),
      pathSpecs: [
        { path: SOLAR_ENERGY_PATH, aggregate: 'last', parameter: [] },
        { path: MOTOR_ENERGY_PATH, aggregate: 'last', parameter: [] }
      ]
    })
    return parseSeed(response, midnight)
  } catch {
    return {}
  }
}
