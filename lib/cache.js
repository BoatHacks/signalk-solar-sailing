// Last-value cache for values published rarely (plan 10, "Checked on the
// boat server"). The server nulls a path 60 s after its last update, and the
// solar forecast arrives once an hour, so the tick reads this cache instead
// of the tree. Nothing is counted: a repeated delta only rewrites the same
// value. Pure, no I/O: index.js feeds it from a subscription.

const SKIP = new Set(['value', 'values', 'meta', 'state', 'timestamp', '$source', 'pgn', 'sentence'])

export class LastValueCache {
  /** @param {string} prefix absolute path of the subtree, e.g. electrical.energy.prediction */
  constructor (prefix) {
    this.prefix = prefix
    /** @type {Record<string, any>} */
    this.root = {}
  }

  /**
   * Store a value at a path relative to the prefix. `null` and `undefined`
   * are ignored: the server's timeout sends null, and a value the source
   * stopped publishing is dropped by the reader by its age instead.
   * @param {string} rel
   * @param {unknown} value
   * @param {number} time epoch ms
   */
  put (rel, value, time) {
    if (value === null || value === undefined || !rel) return
    let o = this.root
    for (const k of rel.split('.')) {
      if (!o[k] || typeof o[k] !== 'object') o[k] = {}
      o = o[k]
    }
    o.value = value
    o.timestamp = new Date(time).toISOString()
  }

  /**
   * Take the values from a Signal K delta that fall under the prefix.
   * @param {any} delta
   * @param {number} now fallback when an update has no timestamp
   */
  applyDelta (delta, now) {
    const head = this.prefix + '.'
    for (const u of (delta && Array.isArray(delta.updates) ? delta.updates : [])) {
      const parsed = typeof u.timestamp === 'string' ? Date.parse(u.timestamp) : NaN
      const t = Number.isNaN(parsed) ? now : parsed
      for (const pv of (Array.isArray(u.values) ? u.values : [])) {
        if (pv && typeof pv.path === 'string' && pv.path.startsWith(head)) this.put(pv.path.slice(head.length), pv.value, t)
      }
    }
  }

  /**
   * Fill from the server's tree at start, so a restart doesn't wait an hour
   * for the next forecast. Timed-out leaves keep their data in
   * `state.lastValue`.
   * @param {unknown} node the subtree at the prefix
   * @param {number} now
   */
  seed (node, now) {
    /** @param {any} n @param {string} rel */
    const walk = (n, rel) => {
      if (!n || typeof n !== 'object' || Array.isArray(n)) return
      if ('value' in n) {
        const v = n.value !== null && n.value !== undefined ? n.value : (n.state && n.state.lastValue)
        const t = typeof n.timestamp === 'string' && !Number.isNaN(Date.parse(n.timestamp)) ? Date.parse(n.timestamp) : now
        if (rel) this.put(rel, v, t)
      }
      for (const [k, child] of Object.entries(n)) {
        if (!SKIP.has(k)) walk(child, rel ? `${rel}.${k}` : k)
      }
    }
    walk(node, '')
  }

  /** The cached subtree, in tree shape ({ value, timestamp } leaves). */
  tree () {
    return this.root
  }

  clear () {
    this.root = {}
  }
}
