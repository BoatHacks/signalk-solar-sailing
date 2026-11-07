import { test } from 'node:test'
import assert from 'node:assert/strict'
import { offsetMinutes, formatTime, formatDate, formatAge } from '../../public/js/time.js'

const T = Date.parse('2026-11-07T23:30:00Z')

test('offset parsing', () => {
  assert.equal(offsetMinutes(200), 120)
  assert.equal(offsetMinutes(-930), -570)
  assert.equal(offsetMinutes('0'), 0)
  assert.equal(offsetMinutes(undefined), undefined)
  assert.equal(offsetMinutes('x'), undefined)
})

test('ship time without zone text, else UTC with Z', () => {
  assert.equal(formatTime(T, 120), '01:30')
  assert.equal(formatTime(T, -570), '14:00')
  assert.equal(formatTime(T, undefined), '23:30Z')
  assert.equal(formatDate(T, 120), '2026-11-08')
  assert.equal(formatDate(T, undefined), '2026-11-07')
})

test('age', () => {
  assert.equal(formatAge(4000), '4 s')
  assert.equal(formatAge(180000), '3 min')
  assert.equal(formatAge(7200000), '2 h')
})
