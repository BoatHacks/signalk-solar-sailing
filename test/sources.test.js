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

test('battery: change-only values stay usable for changeOnlyStaleSeconds', () => {
  const tree = treeOf({
    'electrical.batteries.main.stateOfCharge': 0.886,
    'electrical.batteries.main.power': -10.6
  }, NOW)
  const at = (/** @type {number} */ s) => pick(readBattery(tree, cfg({ batteryId: 'main' }), NOW + s * 1000))
  assert.deepEqual(at(60), { id: 'main', soc: 0.886, watts: -10.6 })
  assert.deepEqual(at(121), { id: 'main', soc: undefined, watts: undefined })
})

test('a value the server has timed out (null) is absent, not 0', () => {
  const tree = treeOf({ 'electrical.venus.dcPower': 10.6 }, NOW)
  tree.electrical.venus.dcPower.value = null
  assert.equal(readSources(tree, cfg(), NOW).dcSystem, undefined)
})

test('DC system power from the configured path, stale like any value', () => {
  const tree = treeOf({ 'electrical.venus.dcPower': 260, 'my.dc': 10 }, NOW)
  assert.deepEqual(pick(readSources(tree, cfg(), NOW).dcSystem, ['watts', 'stale']), { watts: 260, stale: false })
  assert.equal(readSources(tree, cfg({ dcSystemPowerPath: 'my.dc' }), NOW).dcSystem.watts, 10)
  // Change-only sources: a steady reading stays usable past staleSeconds.
  assert.equal(readSources(tree, cfg(), NOW + 60000).dcSystem.stale, false)
  assert.equal(readSources(tree, cfg(), NOW + 121000).dcSystem.stale, true)
  assert.equal(readSources(tree, cfg({ changeOnlyStaleSeconds: 10 }), NOW + 11000).dcSystem.stale, true)
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

test('position: fresh within positionMaxAgeMinutes, invalid ignored', () => {
  const tree = {}
  setIn(tree, 'navigation.position', { value: { latitude: 54.32, longitude: 10.12 }, timestamp: new Date(NOW - 30 * 60000).toISOString() })
  assert.deepEqual(readSources(tree, cfg(), NOW).position, { lat: 54.32, lon: 10.12, time: NOW - 30 * 60000, stale: false })
  assert.equal(readSources(tree, cfg({ positionMaxAgeMinutes: 20 }), NOW).position?.stale, true)
  setIn(tree, 'navigation.position', { value: { latitude: 120, longitude: 0 }, timestamp: new Date(NOW).toISOString() })
  assert.equal(readSources(tree, cfg(), NOW).position, undefined)
  setIn(tree, 'navigation.position', { value: null, timestamp: new Date(NOW).toISOString() })
  assert.equal(readSources(tree, cfg(), NOW).position, undefined)
})

test('battery capacity.nominal (J) read as Wh', () => {
  const tree = treeOf({ 'electrical.batteries.main.stateOfCharge': 0.8, 'electrical.batteries.main.capacity.nominal': 14500 * 3600 }, NOW)
  assert.equal(readBattery(tree, cfg(), NOW)?.capacityWh, 14500)
  const none = treeOf({ 'electrical.batteries.main.stateOfCharge': 0.8 }, NOW)
  assert.equal(readBattery(none, cfg(), NOW)?.capacityWh, undefined)
})

test('forecast read from the cached node only when useForecast is on', () => {
  const t = new Date(NOW).toISOString()
  const node = { status: { value: 'stable', timestamp: t }, forecast: { hourly: { value: [{ time: t, idealSolarYieldWh: 100, houseLoadWh: 20 }], timestamp: t } } }
  assert.equal(readSources({}, cfg(), NOW, node).forecast?.hours.length, 1)
  assert.equal(readSources({}, cfg({ useForecast: false }), NOW, node).forecast, undefined)
  const r = readSources({}, cfg(), NOW)
  assert.deepEqual([r.forecast, r.position], [undefined, undefined])
})

test('speed through water: configured path, stale like any value, empty path skips', () => {
  const tree = treeOf({ 'navigation.speedThroughWater': 2.1 }, NOW)
  assert.deepEqual(readSources(tree, cfg(), NOW).stw, { mps: 2.1, time: NOW, stale: false })
  assert.equal(readSources(tree, cfg(), NOW + 11000).stw?.stale, true)
  assert.equal(readSources(tree, cfg({ speedThroughWaterPath: '' }), NOW).stw, undefined)
  const other = treeOf({ 'navigation.log.stw': 1.5 }, NOW)
  assert.equal(readSources(other, cfg({ speedThroughWaterPath: 'navigation.log.stw' }), NOW).stw?.mps, 1.5)
  setIn(tree, 'navigation.speedThroughWater', { value: null, timestamp: new Date(NOW).toISOString() })
  assert.equal(readSources(tree, cfg(), NOW).stw, undefined)
})

test('ground: SOG and COG together, stale when either is old', () => {
  const tree = treeOf({ 'navigation.speedOverGround': 2, 'navigation.courseOverGroundTrue': 1 }, NOW)
  assert.deepEqual(readSources(tree, cfg(), NOW).ground, { sog: 2, cog: 1, time: NOW, stale: false })
  setIn(tree, 'navigation.courseOverGroundTrue', leaf(1, NOW - 20000))
  assert.equal(readSources(tree, cfg(), NOW).ground?.stale, true)
  assert.equal(readSources(treeOf({ 'navigation.speedOverGround': 2 }, NOW), cfg(), NOW).ground, undefined)
})

test('course: next point and route distance; null route distance means no route', () => {
  const tree = treeOf({ 'navigation.course.calcValues.distance': 9000, 'navigation.course.calcValues.route.distance': 36000 }, NOW)
  // course-provider's own ETA is null whenever VMC <= 0; it is not read.
  setIn(tree, 'navigation.course.calcValues.timeToGo', { value: null, timestamp: new Date(NOW).toISOString() })
  setIn(tree, 'navigation.course.calcValues.estimatedTimeOfArrival', { value: null, timestamp: new Date(NOW).toISOString() })
  assert.deepEqual(readSources(tree, cfg(), NOW).course, { nextM: 9000, routeM: 36000, bearingTrue: undefined, time: NOW, stale: false })
  setIn(tree, 'navigation.course.calcValues.route.distance', { value: null, timestamp: new Date(NOW).toISOString() })
  assert.equal(readSources(tree, cfg(), NOW).course?.routeM, undefined)
  assert.equal(readSources(tree, cfg(), NOW + 121000).course?.stale, true)
  setIn(tree, 'navigation.course.calcValues.distance', { value: null, timestamp: new Date(NOW).toISOString() })
  assert.equal(readSources(tree, cfg(), NOW).course, undefined)
})

test('navigation state from the kept leaf or a bare string', () => {
  assert.equal(readSources({}, cfg(), NOW, undefined, 'sailing').navState, 'sailing')
  assert.equal(readSources({}, cfg(), NOW, undefined, { value: 'motoring' }).navState, 'motoring')
  assert.equal(readSources({}, cfg(), NOW, undefined, { value: null }).navState, undefined)
  const r = readSources({}, cfg(), NOW)
  assert.deepEqual([r.stw, r.ground, r.navState, r.course], [undefined, undefined, undefined, undefined])
})

test('heading, course bearing and environment.current (object or leaves)', () => {
  const tree = treeOf({ 'navigation.headingTrue': 1.2, 'navigation.course.calcValues.distance': 9000, 'navigation.course.calcValues.bearingTrue': 3 }, NOW)
  setIn(tree, 'environment.current', { value: { setTrue: 0.5, drift: 0.3 }, timestamp: new Date(NOW).toISOString() })
  const r = readSources(tree, cfg(), NOW)
  assert.deepEqual(r.heading, { rad: 1.2, time: NOW, stale: false })
  assert.equal(r.course?.bearingTrue, 3)
  assert.deepEqual(r.current, { setTrue: 0.5, drift: 0.3, time: NOW, stale: false })
  const leaves = treeOf({ 'environment.current.setTrue': 0.5, 'environment.current.drift': 0.3 }, NOW)
  assert.deepEqual(readSources(leaves, cfg(), NOW).current, { setTrue: 0.5, drift: 0.3, time: NOW, stale: false })
  assert.equal(readSources(treeOf({ 'environment.current.setTrue': 0.5 }, NOW), cfg(), NOW).current, undefined)
})
