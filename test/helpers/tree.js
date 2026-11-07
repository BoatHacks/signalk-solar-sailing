// Builds Signal K style trees ({ value, timestamp }) for tests.

import { readFileSync } from 'node:fs'

/**
 * @param {number} value
 * @param {number} t epoch ms
 */
export const leaf = (value, t) => ({ value, timestamp: new Date(t).toISOString(), $source: 'test' })

/**
 * Set a dotted path in a plain object.
 * @param {Record<string, any>} tree
 * @param {string} path
 * @param {unknown} value
 */
export function setIn (tree, path, value) {
  const keys = path.split('.')
  let o = tree
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}
  o[keys[keys.length - 1]] = value
  return tree
}

/**
 * Tree from { path: value } at one time.
 * @param {Record<string, number>} values
 * @param {number} t
 */
export function treeOf (values, t) {
  const tree = {}
  for (const [p, v] of Object.entries(values)) setIn(tree, p, leaf(v, t))
  return tree
}

export function loadCurtisLog () {
  const url = new URL('../fixtures/curtis-2026-10-25.json', import.meta.url)
  return /** @type {{ events: [number, string, unknown][] }} */ (JSON.parse(readFileSync(url, 'utf8')))
}
