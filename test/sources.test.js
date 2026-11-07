import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSources, readSolar, readMotor, readBattery, parseTimezoneOffset } from '../lib/sources.js'
import { resolveConfig } from '../lib/config.js'
import { leaf, treeOf, setIn, loadCurtisLog } from './helpers/tree.js'
import { replay } from './helpers/replay.js'

const NOW = Date.parse('2026-11-07T10:00:00Z')
const cfg = (o = {}) => resolveConfig(o).config

test('two MPPTs are summed; a stale one is excluded', () => {
  const tree = treeOf({ 'electrical.solar.278.panelPower': 300, 'electrical.solar.279.panelPower': 200 }, NOW)
  let r = readSolar(tree, cfg(), NOW)
  assert.equal(r.solar.filter((s) => !s.stale).reduce((a, s) => a + s.watts, 0), 500)
  setIn(tree, 'electrical.solar.279.panelPower', leaf(200, NOW - 11000))
  r = readSolar(tree, cfg(), NOW)
  assert.deepEqual(r.solar.map((s) => [s.id, s.stale]), [['278', false], ['279', true]])
})

test('all chargers stale and no total: solar readings all stale', () => {
  const tree = treeOf({ 'electrical.solar.278.panelPower': 300 }, NOW - 60000)
  const r = readSolar(tree, cfg(), NOW)
  assert.equal(r.solarFallback, false)
  assert.ok(r.solar.every((s) => s.stale))
})

test('no fresh charger: falls back to totalPanelPower and flags it', () => {
  const tree = treeOf({ 'electrical.venus.totalPanelPower': 420 }, NOW)
  setIn(tree, 'electrical.solar.278.panelPower', leaf(300, NOW - 60000))
  const r = readSolar(tree, cfg(), NOW)
  assert.equal(r.solarFallback, true)
  assert.deepEqual(r.solar.map((s) => s.watts), [420])
})

test('forecast subtrees under a charger are ignored', () => {
  const tree = treeOf({ 'electrical.solar.278.panelPower': 100, 'electrical.solar.278.forecast.power': 900, 'electrical.solar.forecast.power.today': 5000 }, NOW)
  const r = readSolar(tree, cfg(), NOW)
  assert.deepEqual(r.solar.map((s) => [s.id, s.watts]), [['278', 100]])
})

test('solar override: single value, single charger, or parent', () => {
  const tree = treeOf({ 'x.pv': 77, 'y.a.power': 10, 'y.b.power': 20, 'electrical.solar.1.panelPower': 999 }, NOW)
  assert.deepEqual(readSolar(tree, cfg({ solarPath: 'x.pv' }), NOW).solar.map((s) => s.watts), [77])
  assert.deepEqual(readSolar(tree, cfg({ solarPath: 'y.a' }), NOW).solar.map((s) => s.watts), [10])
  assert.deepEqual(readSolar(tree, cfg({ solarPath: 'y' }), NOW).solar.map((s) => s.watts), [10, 20])
})

test('motor: power, else |V*I|; propulsion from the configured path', () => {
  const tree = treeOf({
    'electrical.motordrive.99.voltage': 53.5,
    'electrical.motordrive.99.current': -2,
    'propulsion.99.revolutions': 6,
    'propulsion.99.direction': 2,
    'propulsion.99.temperature': 293,
    'propulsion.99.transmission.gearRatio': 2.5
  }, NOW)
  assert.equal(readMotor(tree, cfg(), NOW).rpm, undefined, 'default propulsion.main has no data')
  const m = readMotor(tree, cfg({ propulsionPath: 'propulsion.99' }), NOW)
  assert.equal(m.watts, 107)
  assert.equal(m.rpm, 360)
  assert.equal(m.direction, 2)
  assert.equal(m.gearRatio, 2.5)
  assert.equal(m.inDrive, true)
  assert.deepEqual(m.temperatures, { temperature: 293 })
  setIn(tree, 'electrical.motordrive.99.power', leaf(-80, NOW))
  assert.equal(readMotor(tree, cfg(), NOW).watts, 80)
})

test('gear ratio only when finite and > 0, and never stale', () => {
  const tree = treeOf({ 'electrical.motordrive.99.power': 50, 'propulsion.main.transmission.gearRatio': 0 }, NOW)
  assert.equal(readMotor(tree, cfg(), NOW).gearRatio, undefined)
  setIn(tree, 'propulsion.main.transmission.gearRatio', leaf(2, NOW - 86400000))
  assert.equal(readMotor(tree, cfg(), NOW).gearRatio, 2)
})

test('inDrive: direction != 0 and power > idle; no direction -> power only', () => {
  const at = (o) => readMotor(treeOf(o, NOW), cfg(), NOW).inDrive
  assert.equal(at({ 'electrical.motordrive.99.power': 100, 'propulsion.main.direction': 0 }), false)
  assert.equal(at({ 'electrical.motordrive.99.power': 100, 'propulsion.main.direction': 1 }), true)
  assert.equal(at({ 'electrical.motordrive.99.power': 10, 'propulsion.main.direction': 1 }), false)
  assert.equal(at({ 'electrical.motordrive.99.power': 100 }), true)
  assert.equal(at({ 'electrical.motordrive.99.power': 15 }), false)
})

test('stale motor power: no watts, not in drive', () => {
  const tree = treeOf({ 'electrical.motordrive.99.power': 100 }, NOW - 20000)
  const m = readMotor(tree, cfg(), NOW)
  assert.equal(m.stale, true)
  assert.equal(m.watts, undefined)
  assert.equal(m.inDrive, false)
})

test('motor power override', () => {
  const tree = treeOf({ 'electrical.motordrive.99.power': 100, 'propulsion.port.power': -40 }, NOW)
  const m = readMotor(tree, cfg({ motorPowerPath: 'propulsion.port.power' }), NOW)
  assert.equal(m.watts, 40)
})

test('battery: first bank, configured id, override and sign inversion', () => {
  const tree = treeOf({
    'electrical.batteries.288.stateOfCharge': 0.8,
    'electrical.batteries.288.power': 150,
    'electrical.batteries.512.voltage': 12.5,
    'electrical.batteries.512.current': -4
  }, NOW)
  assert.deepEqual(pick(readBattery(tree, cfg(), NOW)), { id: '288', soc: 0.8, watts: 150 })
  assert.deepEqual(pick(readBattery(tree, cfg({ batteryId: '512' }), NOW)), { id: '512', soc: undefined, watts: -50 })
  assert.equal(readBattery(tree, cfg({ invertBatteryPower: true }), NOW).watts, -150)
  assert.equal(readBattery(tree, cfg({ batteryPath: 'electrical.batteries.512' }), NOW).id, '512')
  assert.equal(readBattery({}, cfg(), NOW), undefined)
})

test('DC system power from the configured path, stale like any value', () => {
  const tree = treeOf({ 'electrical.venus.dcPower': 260, 'my.dc': 10 }, NOW)
  assert.deepEqual(pick(readSources(tree, cfg(), NOW).dcSystem, ['watts', 'stale']), { watts: 260, stale: false })
  assert.equal(readSources(tree, cfg({ dcSystemPowerPath: 'my.dc' }), NOW).dcSystem.watts, 10)
  assert.equal(readSources(tree, cfg(), NOW + 11000).dcSystem.stale, true)
  assert.equal(readSources(tree, cfg({ dcSystemPowerPath: '' }), NOW).dcSystem, undefined)
})

test('timezone offset parsing', () => {
  assert.equal(parseTimezoneOffset(200), 120)
  assert.equal(parseTimezoneOffset(-930), -570)
  assert.equal(parseTimezoneOffset('0'), 0)
  assert.equal(parseTimezoneOffset({ value: 530 }), 330)
  assert.equal(parseTimezoneOffset(undefined), undefined)
  assert.equal(parseTimezoneOffset('abc'), undefined)
  assert.equal(parseTimezoneOffset(2500), undefined)
})

test('empty tree gives empty readings, never throws', () => {
  const r = readSources({}, cfg(), NOW)
  assert.deepEqual(r.solar, [])
  assert.equal(r.motor, undefined)
  assert.equal(r.battery, undefined)
})

test('Curtis log: in drive only while direction != 0 and drawing power', () => {
  const { events } = loadCurtisLog()
  const config = cfg({ propulsionPath: 'propulsion.99' })
  let drive = 0
  let total = 0
  replay(events, 1000, (tree, now) => {
    const m = readMotor(tree, config, now)
    if (!m) return
    total++
    if (m.inDrive) {
      drive++
      assert.notEqual(m.direction, 0)
      assert.ok(m.watts > config.idlePowerW)
      assert.ok(m.rpm > 0)
    }
  })
  assert.ok(drive > 5, `in drive for ${drive} of ${total} ticks`)
  assert.ok(drive < total)
})

/** @param {any} o @param {string[]} [keys] */
function pick (o, keys = ['id', 'soc', 'watts']) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]))
}
