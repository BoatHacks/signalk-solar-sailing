import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EnergyCounter, dayKey, localMidnight } from '../lib/energy.js'

const T = Date.parse('2026-11-07T10:00:00Z')

test('trapezoid integration, gaps over 30 s skipped, NaN breaks the chain', () => {
  const c = new EnergyCounter()
  c.add(100, T)
  c.add(200, T + 10000)
  assert.equal(c.joules, 1500)
  c.add(200, T + 50000)
  assert.equal(c.joules, 1500)
  c.add(undefined, T + 51000)
  c.add(100, T + 52000)
  assert.equal(c.joules, 1500)
})

test('rollover at ship midnight', () => {
  for (const [offset, midnightUtc] of [[120, '2026-11-07T22:00:00Z'], [-570, '2026-11-08T09:30:00Z'], [0, '2026-11-08T00:00:00Z'], [undefined, '2026-11-08T00:00:00Z']]) {
    const m = Date.parse(midnightUtc)
    const c = new EnergyCounter()
    c.add(100, m - 10000, offset)
    c.add(100, m - 1000, offset)
    assert.equal(c.joules, 900, `before midnight at ${offset}`)
    c.add(100, m + 1000, offset)
    assert.equal(c.joules, 0, `reset at midnight at ${offset}`)
    assert.equal(localMidnight(m + 5000, offset), m)
  }
  assert.equal(dayKey(Date.parse('2026-11-07T23:30:00Z'), 120), '2026-11-08')
})

test('seed continues today and is dropped on a new day', () => {
  const c = new EnergyCounter()
  c.seed(5000, T)
  c.add(100, T)
  c.add(100, T + 10000)
  assert.equal(c.joules, 6000)
  c.add(100, T + 86400000)
  assert.equal(c.joules, 0)
})
