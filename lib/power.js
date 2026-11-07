// Pure helpers that turn Signal K data trees into watts.
// No I/O here, so everything in this file is unit-tested directly.

/**
 * @param {unknown} v
 * @returns {v is number}
 */
export const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Extract `.value` from a Signal K leaf ({ value, timestamp, $source }) or
 * accept a bare number.
 * @param {unknown} leaf
 * @returns {number | undefined}
 */
export function leafValue (leaf) {
  if (leaf === null || leaf === undefined) return undefined
  if (finite(leaf)) return leaf
  if (typeof leaf === 'object' && finite(/** @type {any} */ (leaf).value)) return /** @type {any} */ (leaf).value
  return undefined
}

/**
 * Timestamp of a leaf in ms since the epoch.
 * @param {unknown} leaf
 * @returns {number | undefined}
 */
export function leafTime (leaf) {
  if (leaf && typeof leaf === 'object' && typeof /** @type {any} */ (leaf).timestamp === 'string') {
    const t = Date.parse(/** @type {any} */ (leaf).timestamp)
    return Number.isNaN(t) ? undefined : t
  }
  return undefined
}

/**
 * @param {unknown[]} leaves
 * @returns {number | undefined}
 */
export function newestTime (leaves) {
  let t
  for (const l of leaves) {
    const lt = leafTime(l)
    if (lt !== undefined && (t === undefined || lt > t)) t = lt
  }
  return t
}

/** @typedef {{ watts: number, via: string, time?: number }} Power */

/**
 * Solar chargers / MPPTs report differently. Prefer an explicit power value,
 * then panel side V*I, then charger output V*I. Only the node's own leaves are
 * read, so nested subtrees (e.g. `forecast.*`) never count.
 * @param {unknown} node
 * @returns {Power | undefined}
 */
export function solarPowerFromNode (node) {
  if (!node || typeof node !== 'object') return undefined
  const n = /** @type {Record<string, unknown>} */ (node)
  const candidates = [
    ['panelPower'],
    ['power'],
    ['panelVoltage', 'panelCurrent'],
    ['voltage', 'current']
  ]
  for (const keys of candidates) {
    const vals = keys.map((k) => leafValue(n[k]))
    if (vals.every(finite)) {
      const w = /** @type {number[]} */ (vals).reduce((a, b) => a * b, 1)
      return { watts: Math.max(0, w), via: keys.join('*'), time: newestTime(keys.map((k) => n[k])) }
    }
  }
  return undefined
}

/**
 * Electric motors: explicit power, else |V*I| (discharge current is often
 * reported negative, so take the magnitude).
 * @param {unknown} node
 * @returns {Power | undefined}
 */
export function motorPowerFromNode (node) {
  if (!node || typeof node !== 'object') return undefined
  const n = /** @type {Record<string, unknown>} */ (node)
  const p = leafValue(n.power)
  if (finite(p)) return { watts: Math.abs(p), via: 'power', time: leafTime(n.power) }
  const v = leafValue(n.voltage)
  const i = leafValue(n.current)
  if (finite(v) && finite(i)) {
    return { watts: Math.abs(v * i), via: 'voltage*current', time: newestTime([n.voltage, n.current]) }
  }
  return undefined
}

/**
 * Walk an object by dotted path ("electrical.solar") safely.
 * @param {unknown} obj
 * @param {string} dotted
 * @returns {unknown}
 */
export function getIn (obj, dotted) {
  if (!dotted) return obj
  return dotted.split('.').reduce((o, k) => (o && typeof o === 'object' ? /** @type {any} */ (o)[k] : undefined), obj)
}

/**
 * Read a single numeric path that may be a leaf, or a node with V/I children.
 * @param {unknown} tree
 * @param {string} dotted
 * @param {'solar'|'motor'} kind
 * @returns {Power | undefined}
 */
export function powerFromPath (tree, dotted, kind) {
  const node = getIn(tree, dotted)
  if (node === undefined) return undefined
  const direct = leafValue(node)
  if (finite(direct)) {
    const watts = kind === 'solar' ? Math.max(0, direct) : Math.abs(direct)
    return { watts, via: dotted, time: leafTime(node) }
  }
  return kind === 'solar' ? solarPowerFromNode(node) : motorPowerFromNode(node)
}

/**
 * Value and time of a leaf, without walking into children.
 * @param {unknown} tree
 * @param {string} dotted
 * @returns {{ value: number, time?: number } | undefined}
 */
export function readLeaf (tree, dotted) {
  if (!dotted) return undefined
  const leaf = getIn(tree, dotted)
  const value = leafValue(leaf)
  return value === undefined ? undefined : { value, time: leafTime(leaf) }
}
