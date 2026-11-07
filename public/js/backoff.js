// Reconnect delay: 1 s doubling to 60 s, up to 20 % jitter (signalk-visuals 5).

export const BACKOFF_MIN_MS = 1000
export const BACKOFF_MAX_MS = 60000

/**
 * @param {number} attempt 0 for the first retry
 * @param {number} random a value in [0, 1)
 */
export function backoffDelay (attempt, random) {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * Math.pow(2, Math.max(0, attempt)))
  return Math.round(base * (1 - 0.2 * random))
}
