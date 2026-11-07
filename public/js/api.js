// REST reads: status resource, path metadata and the History API window
// (SPEC 5.2, ARCHITECTURE 2.9). Parsing is pure and tested in Node. ES2017.

export const STATUS_URL = '/signalk/v2/api/resources/solar-sailing/status'
export const META_URL = '/signalk/v1/api/vessels/self/plugin/solarsailing'
export const HISTORY_URL = '/signalk/v2/api/history/values'

/** Chart series: key, published path. */
export const SERIES = [
  { key: 'solar', path: 'plugin.solarsailing.solarPower' },
  { key: 'motor', path: 'plugin.solarsailing.motorPower' },
  { key: 'budget', path: 'plugin.solarsailing.budget' }
]

/** Points per chart window; resolution is scaled so the reply stays small. */
export const CHART_POINTS = 360

/**
 * @param {number} hours
 */
export function historyUrl (hours) {
  const paths = SERIES.map((s) => s.path + ':average').join(',')
  const resolution = Math.max(1, Math.round((hours * 3600) / CHART_POINTS))
  return HISTORY_URL + '?paths=' + encodeURIComponent(paths) + '&duration=PT' + hours + 'H&resolution=' + resolution
}

/**
 * ValuesResponse → `{ t: number[], solar: [], motor: [], budget: [] }`.
 * Columns are matched by path, so the provider's order does not matter.
 * @param {any} res
 */
export function parseHistory (res) {
  const out = { t: [], solar: [], motor: [], budget: [] }
  if (!res || !Array.isArray(res.values) || !Array.isArray(res.data)) return out
  const cols = SERIES.map((s) => {
    for (let i = 0; i < res.values.length; i++) {
      if (res.values[i] && res.values[i].path === s.path) return i
    }
    return -1
  })
  for (let r = 0; r < res.data.length; r++) {
    const row = res.data[r]
    if (!Array.isArray(row)) continue
    const t = typeof row[0] === 'number' ? row[0] : Date.parse(row[0])
    if (!isFinite(t)) continue
    out.t.push(t)
    for (let s = 0; s < SERIES.length; s++) {
      const v = cols[s] >= 0 ? row[cols[s] + 1] : null
      out[SERIES[s].key].push(typeof v === 'number' && isFinite(v) ? v : null)
    }
  }
  return out
}

/**
 * `plugin/solarsailing` tree → `{ key: meta }`.
 * @param {any} tree
 */
export function parseMeta (tree) {
  const out = {}
  if (!tree || typeof tree !== 'object') return out
  Object.keys(tree).forEach((k) => {
    if (tree[k] && typeof tree[k] === 'object' && tree[k].meta) out[k] = tree[k].meta
  })
  return out
}

/**
 * @param {(url: string) => Promise<any>} fetchFn
 * @param {string} url
 */
async function getJson (fetchFn, url) {
  const res = await fetchFn(url)
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status)
    // @ts-ignore
    err.status = res.status
    throw err
  }
  return res.json()
}

/**
 * Chart data, or `state: 'none'` when no history provider answers.
 * @param {(url: string) => Promise<any>} fetchFn
 * @param {number} hours
 */
export async function loadHistory (fetchFn, hours) {
  try {
    const res = await getJson(fetchFn, historyUrl(hours))
    const points = parseHistory(res)
    return { state: points.t.length ? 'ok' : 'empty', points: points }
  } catch (e) {
    const status = e && e.status
    return { state: status === 404 || status === 501 || status === 503 ? 'none' : 'error', points: parseHistory(null) }
  }
}

/** @param {(url: string) => Promise<any>} fetchFn */
export async function loadStatus (fetchFn) {
  try {
    return await getJson(fetchFn, STATUS_URL)
  } catch (e) {
    return undefined
  }
}

/** @param {(url: string) => Promise<any>} fetchFn */
export async function loadMeta (fetchFn) {
  try {
    return parseMeta(await getJson(fetchFn, META_URL))
  } catch (e) {
    return {}
  }
}
