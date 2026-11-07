import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leafValue, leafTime, solarPowerFromNode, motorPowerFromNode, powerFromPath, getIn, readLeaf } from '../lib/power.js'
import { leaf } from './helpers/tree.js'

const T = Date.parse('2026-11-07T10:00:00Z')

test('leafValue accepts leaves and bare numbers, rejects the rest', () => {
  assert.equal(leafValue(leaf(3, T)), 3)
  assert.equal(leafValue(4), 4)
  assert.equal(leafValue({ value: 'x' }), undefined)
  assert.equal(leafValue(null), undefined)
  assert.equal(leafValue(NaN), undefined)
  assert.equal(leafTime(leaf(1, T)), T)
  assert.equal(leafTime({ value: 1, timestamp: 'nonsense' }), undefined)
})

test('solarPowerFromNode prefers panelPower, then power, then panel V*I, then V*I', () => {
  assert.equal(solarPowerFromNode({ panelPower: leaf(120, T), power: leaf(5, T) }).via, 'panelPower')
  assert.equal(solarPowerFromNode({ power: leaf(80, T) }).watts, 80)
  const vi = solarPowerFromNode({ panelVoltage: leaf(40, T), panelCurrent: leaf(2.5, T) })
  assert.deepEqual([vi.watts, vi.via], [100, 'panelVoltage*panelCurrent'])
  assert.equal(solarPowerFromNode({ voltage: leaf(54, T), current: leaf(-1, T) }).watts, 0)
  assert.equal(solarPowerFromNode({ forecast: { power: leaf(500, T) } }), undefined)
})

test('motorPowerFromNode takes |power|, else |V*I|', () => {
  assert.equal(motorPowerFromNode({ power: leaf(-138, T) }).watts, 138)
  const p = motorPowerFromNode({ voltage: leaf(53.5, T), current: leaf(-2, T + 1000) })
  assert.equal(p.watts, 107)
  assert.equal(p.time, T + 1000)
  assert.equal(motorPowerFromNode({ voltage: leaf(53.5, T) }), undefined)
})

test('powerFromPath reads a value or a node', () => {
  const tree = { a: { b: leaf(-50, T), c: { power: leaf(-20, T) } } }
  assert.equal(powerFromPath(tree, 'a.b', 'motor').watts, 50)
  assert.equal(powerFromPath(tree, 'a.b', 'solar').watts, 0)
  assert.equal(powerFromPath(tree, 'a.c', 'motor').watts, 20)
  assert.equal(powerFromPath(tree, 'a.x', 'motor'), undefined)
  assert.equal(getIn(tree, ''), tree)
  assert.deepEqual(readLeaf(tree, 'a.b'), { value: -50, time: T })
  assert.equal(readLeaf(tree, ''), undefined)
})
