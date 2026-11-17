import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageOptions, layoutFor, sizeText } from '../../public/js/display.js'
import { DEVICES, device } from '../../scripts/devices.mjs'

test('page options from the query string', () => {
  assert.deepEqual(pageOptions(''), { layout: undefined, size: false, reduceMotion: false })
  assert.deepEqual(pageOptions('?size&motion=off&layout=compact'), { layout: 'compact', size: true, reduceMotion: true })
  assert.equal(pageOptions('?layout=wide').layout, undefined)
  assert.equal(pageOptions('?size=0').size, false)
  assert.equal(pageOptions('?motion=reduce').reduceMotion, true)
  assert.equal(pageOptions('?motion=on').reduceMotion, false)
})

test('compact layout on short landscape screens only', () => {
  assert.equal(layoutFor(670, 430), 'compact') // Vulcan 9 FS
  assert.equal(layoutFor(1024, 600), 'compact') // Waveshare 7"
  assert.equal(layoutFor(844, 390), 'compact') // phone sideways
  assert.equal(layoutFor(390, 844), 'normal') // phone
  assert.equal(layoutFor(1280, 860), 'normal') // nav station
  assert.equal(layoutFor(1280, 860, 'compact'), 'compact')
  assert.equal(layoutFor(670, 430, 'normal'), 'normal')
})

test('size readout', () => {
  assert.equal(sizeText(670, 430, 1), '670×430 @1x')
  assert.equal(sizeText(390.4, 844, 2.625), '390×844 @2.63x')
})

test('device list: every entry is complete, aliases resolve', () => {
  for (const [id, d] of Object.entries(DEVICES)) {
    assert.match(id, /^[a-z0-9-]+$/)
    assert.ok(d.name && d.engine && d.input && d.where, id)
    assert.ok(d.viewport.width > 0 && d.viewport.height > 0 && d.dpr > 0, id)
  }
  assert.equal(device('desktop'), DEVICES.laptop)
  assert.equal(device('vulcan-9fs').viewport.height, 430)
  assert.equal(layoutFor(DEVICES['vulcan-9fs'].viewport.width, DEVICES['vulcan-9fs'].viewport.height), 'compact')
  assert.equal(device('nope'), undefined)
})
