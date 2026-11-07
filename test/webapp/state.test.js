import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store, isFresh, matchTheme, tabFromHash, STALE_MS } from '../../public/js/state.js'
import { backoffDelay } from '../../public/js/backoff.js'

test('store notifies subscribers of their keys only, and unsubscribes', () => {
  const s = new Store()
  const seen = []
  const off = s.subscribe(['a'], (k, v) => seen.push([k, v]))
  s.set('a', 1)
  s.set('b', 2)
  off()
  s.set('a', 3)
  assert.deepEqual(seen, [['a', 1]])
  assert.equal(s.get('a'), 3)
})

test('panel state: grey when stale, missing, null or offline; never green', () => {
  const now = 100000
  assert.equal(isFresh({ value: 5, t: now - 1000 }, now, true), true)
  assert.equal(isFresh({ value: 5, t: now - STALE_MS - 1 }, now, true), false)
  assert.equal(isFresh({ value: null, t: now }, now, true), false)
  assert.equal(isFresh(undefined, now, true), false)
  assert.equal(isFresh({ value: 5, t: now }, now, false), false)
  assert.equal(matchTheme('matched', false, true), 'theme-green')
  assert.equal(matchTheme('matched', false, false), 'theme-offline')
  assert.equal(matchTheme('under', false, true), 'theme-teal')
  assert.equal(matchTheme('over', false, true), 'theme-orange')
  assert.equal(matchTheme('over', true, true), 'theme-red')
  assert.equal(matchTheme('unknown', false, true), 'theme-offline')
})

test('tab from hash', () => {
  assert.equal(tabFromHash('#chart'), 'chart')
  assert.equal(tabFromHash('#/sources'), 'sources')
  assert.equal(tabFromHash(''), 'live')
  assert.equal(tabFromHash('#nonsense'), 'live')
})

test('backoff: 1 s doubling to 60 s, up to 20 % jitter', () => {
  assert.equal(backoffDelay(0, 0), 1000)
  assert.equal(backoffDelay(1, 0), 2000)
  assert.equal(backoffDelay(5, 0), 32000)
  assert.equal(backoffDelay(6, 0), 60000)
  assert.equal(backoffDelay(20, 0), 60000)
  assert.equal(backoffDelay(0, 0.999), 800)
})
