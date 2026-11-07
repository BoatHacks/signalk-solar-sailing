// Replays a recorded event log into a growing Signal K tree, one tick at a time.

import { leaf, setIn } from './tree.js'

/**
 * @param {[number, string, unknown][]} events sorted by time
 * @param {number} stepMs
 * @param {(tree: Record<string, any>, now: number) => void} onTick
 * @param {Record<string, any>} [base] extra tree content refreshed every tick
 */
export function replay (events, stepMs, onTick, base = {}) {
  const tree = {}
  let i = 0
  const start = events[0][0]
  const end = events[events.length - 1][0] + stepMs
  for (let now = start; now <= end; now += stepMs) {
    while (i < events.length && events[i][0] <= now) {
      const [t, path, value] = events[i++]
      if (typeof value === 'number') setIn(tree, path, leaf(value, t))
    }
    for (const [path, value] of Object.entries(base)) setIn(tree, path, leaf(value, now))
    onTick(tree, now)
  }
}
