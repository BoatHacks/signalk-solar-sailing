// Ship time from environment.time.timezoneOffset, else UTC with Z
// (signalk-visuals 7). Pure, ES2017.

/**
 * `(-)hhmm` (number or numeric string) to minutes; undefined when unusable.
 * @param {unknown} v
 */
export function offsetMinutes (v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !isFinite(n)) return undefined
  const sign = n < 0 ? -1 : 1
  const abs = Math.abs(Math.trunc(n))
  const minutes = Math.floor(abs / 100) * 60 + (abs % 100)
  if (minutes > 14 * 60) return undefined
  return sign * minutes
}

/** @param {number} n */
const pad = (n) => (n < 10 ? '0' : '') + n

/**
 * `14:30` in ship time, or `12:30Z` when the offset is unknown.
 * @param {number} ms
 * @param {number | undefined} offsetMin
 */
export function formatTime (ms, offsetMin) {
  const d = new Date(ms + (offsetMin === undefined ? 0 : offsetMin) * 60000)
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + (offsetMin === undefined ? 'Z' : '')
}

/**
 * `YYYY-MM-DD` in ship time (UTC when the offset is unknown).
 * @param {number} ms
 * @param {number | undefined} offsetMin
 */
export function formatDate (ms, offsetMin) {
  const d = new Date(ms + (offsetMin === undefined ? 0 : offsetMin) * 60000)
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
}

/**
 * "4 s", "3 min", "2 h" for an age in ms.
 * @param {number} ms
 */
export function formatAge (ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return s + ' s'
  if (s < 90 * 60) return Math.round(s / 60) + ' min'
  return Math.round(s / 3600) + ' h'
}
