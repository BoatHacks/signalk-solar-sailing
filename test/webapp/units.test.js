import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFormula, formatValue, withPrefix, round3 } from '../../public/js/units.js'

test('formula parser: arithmetic, precedence, parentheses, power, unary minus', () => {
  assert.equal(parseFormula('value * 60')(2), 120)
  assert.equal(parseFormula('value - 273.15')(300), 300 - 273.15)
  assert.equal(parseFormula('(value + 1) * 2')(3), 8)
  assert.equal(parseFormula('value ^ 2 / 4')(4), 4)
  assert.equal(parseFormula('-value')(5), -5)
  assert.equal(parseFormula('value * 0.000539957')(1852).toFixed(3), '1.000')
  assert.equal(parseFormula('1e3 * value')(2), 2000)
  assert.equal(parseFormula('value / 3600')(7200), 2)
})

test('formula parser rejects anything else', () => {
  for (const bad of ['alert(1)', 'value * ', '(value', 'value)', 'Math.PI', 'value; 1', '', 'value value', 'x']) {
    assert.equal(parseFormula(bad), undefined, bad)
  }
})

test('ISO prefixes and rounding', () => {
  assert.deepEqual(withPrefix(1200, 'W'), { text: '1.2', unit: 'kW' })
  assert.deepEqual(withPrefix(15000, 'Wh'), { text: '15', unit: 'kWh' })
  assert.deepEqual(withPrefix(450, 'W'), { text: '450', unit: 'W' })
  assert.deepEqual(withPrefix(-1500, 'W'), { text: '-1.5', unit: 'kW' })
  assert.deepEqual(withPrefix(420, 'rpm'), { text: '420', unit: 'rpm' })
  assert.equal(round3(0), '0')
  assert.equal(round3(12.34), '12.3')
  assert.equal(round3(1.234), '1.23')
  assert.equal(round3(1.2), '1.2')
})

test('formatValue: displayUnits, identity formula, missing values', () => {
  const rpm = { units: 'Hz', displayUnits: { formula: 'value * 60', symbol: 'rpm' } }
  assert.deepEqual(formatValue(7, rpm), { text: '420', unit: 'rpm' })
  const watts = { units: 'W', displayUnits: { formula: 'value', symbol: 'W' } }
  assert.deepEqual(formatValue(1200, watts), { text: '1.2', unit: 'kW' })
  assert.deepEqual(formatValue(3600000, { units: 'J', displayUnits: { formula: 'value / 3600', symbol: 'Wh' } }), { text: '1', unit: 'kWh' })
  assert.deepEqual(formatValue(3600, { units: 'J' }), { text: '3.6', unit: 'kJ' })
  assert.deepEqual(formatValue(7, { units: 'Hz' }), { text: '420', unit: 'rpm' })
  assert.deepEqual(formatValue(null, watts), { text: '-', unit: '' })
  assert.deepEqual(formatValue(NaN, watts), { text: '-', unit: '' })
  assert.deepEqual(formatValue(5, { units: 'W', displayUnits: { formula: 'evil()', symbol: 'X' } }), { text: '5', unit: 'W' })
})
