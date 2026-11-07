// Tiny store: elements subscribe to the keys they show (ARCHITECTURE 2.9).
// Also the pure rules for panel state (fresh / stale / theme). ES2017.

/** A value older than this is shown grey, independent of the server. */
export const STALE_MS = 15000

export class Store {
  constructor () {
    /** @type {Object<string, any>} */
    this.values = {}
    /** @type {Array<{ keys: string[], fn: Function }>} */
    this.listeners = []
  }

  /** @param {string} key */
  get (key) {
    return this.values[key]
  }

  /**
   * @param {string} key
   * @param {any} value
   */
  set (key, value) {
    this.values[key] = value
    for (let i = 0; i < this.listeners.length; i++) {
      const l = this.listeners[i]
      if (l.keys.indexOf(key) >= 0 || l.keys.indexOf('*') >= 0) l.fn(key, value)
    }
  }

  /**
   * @param {string[]} keys
   * @param {(key: string, value: any) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe (keys, fn) {
    const entry = { keys: keys, fn: fn }
    this.listeners.push(entry)
    return () => {
      const i = this.listeners.indexOf(entry)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }
}

/**
 * Is a stored reading `{ value, t }` usable for colour?
 * @param {{ value: any, t: number } | undefined} reading
 * @param {number} now
 * @param {boolean} connected
 */
export function isFresh (reading, now, connected) {
  return Boolean(connected && reading && reading.value !== null && reading.value !== undefined &&
    now - reading.t <= STALE_MS)
}

/**
 * Panel theme for the match state (SPEC 6.2): matched green, under teal,
 * over orange, red once the alarm is active; grey when stale or unknown.
 * @param {string | undefined} state
 * @param {boolean} alarm
 * @param {boolean} fresh
 */
export function matchTheme (state, alarm, fresh) {
  if (!fresh) return 'theme-offline'
  if (state === 'over') return alarm ? 'theme-red' : 'theme-orange'
  if (state === 'matched') return 'theme-green'
  if (state === 'under') return 'theme-teal'
  return 'theme-offline'
}

/**
 * Phone tab from the location hash: `#chart`, `#sources`, else `live`.
 * @param {string} hash
 */
export function tabFromHash (hash) {
  const h = String(hash || '').replace(/^#\/?/, '')
  return h === 'chart' || h === 'sources' ? h : 'live'
}
