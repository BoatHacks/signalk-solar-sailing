import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Smoother, batteryBias, clamp, verdict } from '../lib/matcher.js'

const bias = { socLow: 50, socHigh: 90, chargeReserveW: 100, batteryAssistW: 40 }

test('SoC bias at low, high, midpoint and unknown', () => {
  assert.equal(batteryBias(40, bias), -100)
  assert.equal(batteryBias(50, bias), -100)
  assert.equal(batteryBias(95, bias), 40)
  assert.equal(batteryBias(70, bias), -30)
  assert.equal(batteryBias(undefined, bias), 0)
  assert.equal(batteryBias(NaN, bias), 0)
})

test('verdict uses max(50 W, 10 %) tolerance', () => {
  assert.equal(verdict(340, 300), 'matched')
  assert.equal(verdict(351, 300), 'over')
  assert.equal(verdict(249, 300), 'under')
  assert.equal(verdict(1090, 1000), 'matched')
  assert.equal(verdict(1101, 1000), 'over')
  assert.equal(verdict(undefined, 300), 'unknown')
  assert.equal(verdict(100, undefined), 'unknown')
})

test('Smoother: first value passes, then exponential approach; ignores NaN', () => {
  const s = new Smoother(30)
  assert.equal(s.update(100, 0), 100)
  const v = s.update(200, 30000)
  assert.ok(Math.abs(v - (100 + 100 * (1 - Math.exp(-1)))) < 1e-9)
  assert.equal(s.update(NaN, 31000), v)
  assert.equal(new Smoother(0).update(5, 0), 5)
  assert.equal(clamp(5, 0, 3), 3)
})
