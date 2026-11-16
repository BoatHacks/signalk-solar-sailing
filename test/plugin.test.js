import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import createPlugin from '../index.js'
import { schema, DEFAULTS, resolveConfig } from '../lib/config.js'
import { leaf, setIn } from './helpers/tree.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))

/** Wait (real time) until `cond()` holds. */
async function waitFor (cond, ms = 2000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
const statusOf = (app, i = app.providers.length - 1) => app.providers[i].methods.getResource('status')

/** @param {Record<string, any>} [extra] */
function fakeApp (extra = {}) {
  const tree = {}
  const app = {
    tree,
    messages: [],
    errors: [],
    providers: [],
    subscriptions: [],
    getSelfPath: (p) => tree[p],
    handleMessage: (id, delta) => app.messages.push(delta),
    registerResourceProvider: (p) => app.providers.push(p),
    subscriptionmanager: {
      subscribe: (cmd, unsubscribes, onError, cb) => {
        app.subscriptions.push({ cmd, cb })
        unsubscribes.push(() => { app.unsubscribed = true })
      }
    },
    error: (m) => app.errors.push(m),
    debug: () => {},
    setPluginStatus: () => {},
    ...extra
  }
  return app
}

const paths = (app) => app.messages.flatMap((m) => (m.updates[0].values || []).map((v) => v.path))

test('factory shape and schema defaults match SPEC 8', () => {
  const p = createPlugin(fakeApp())
  for (const k of ['id', 'name', 'schema', 'start', 'stop']) assert.ok(k in p, k)
  const s = schema()
  assert.equal(s.type, 'object')
  for (const [k, v] of Object.entries(DEFAULTS)) assert.deepEqual(s.properties[k].default, v, k)
  assert.equal(DEFAULTS.propulsionPath, 'propulsion.main')
  assert.equal(DEFAULTS.idlePowerW, 15)
  assert.equal(DEFAULTS.dcSystemPowerPath, 'electrical.venus.dcPower')
})

test('config: invalid paths rejected, wrong types fall back', () => {
  const { config, warnings } = resolveConfig({ motorPowerPath: 'a;b', propulsionPath: '../x', staleSeconds: 'x', socLowPercent: 95 })
  assert.equal(config.motorPowerPath, '')
  assert.equal(config.propulsionPath, 'propulsion.main')
  assert.equal(config.staleSeconds, 10)
  assert.equal(config.socLowPercent, 50)
  assert.equal(warnings.length, 3)
})

test('registry activation: default config, empty tree, no history, no data dir', async () => {
  const app = fakeApp()
  const p = createPlugin(app)
  p.start({})
  await flush()
  await flush()
  assert.deepEqual(app.errors, [])
  assert.ok(paths(app).includes('plugin.solarsailing.matchState'))
  assert.equal(app.providers[0].type, 'solar-sailing')
  const status = await app.providers[0].methods.getResource('status')
  assert.equal(status.snapshot.matchState, 'unknown')
  assert.equal(status.snapshot.budgetW, undefined)
  p.stop()
  assert.equal(app.unsubscribed, true)
  assert.deepEqual(app.errors, [])
})

test('scheduler: 10 s idle, 1 s active, wake delta ticks at once, stop clears', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.parse('2026-11-07T10:00:00Z') })
  try {
    const app = fakeApp()
    const p = createPlugin(app)
    p.start({})
    await flush()
    await flush()
    const ticks = () => app.messages.filter((m) => (m.updates[0].values || []).some((v) => v.path === 'plugin.solarsailing.matchState')).length
    const t0 = ticks()
    assert.equal(t0, 1)
    mock.timers.tick(5000)
    // Unchanged values are re-sent every 5 s at most, and the idle tick is 10 s.
    assert.equal(ticks(), 1)
    mock.timers.tick(5000)
    assert.equal(ticks(), 2)

    // Motor goes into drive: the wake delta runs a tick without waiting.
    const now = Date.now()
    setIn(app.tree, 'electrical', {})
    setIn(app.tree.electrical, 'motordrive.99.power', leaf(300, now))
    setIn(app.tree.electrical, 'solar.278.panelPower', leaf(400, now))
    app.tree.propulsion = { main: { direction: leaf(1, now) } }
    // A wake right after a tick is held to one tick per second...
    app.subscriptions[0].cb({})
    app.subscriptions[0].cb({})
    assert.equal(ticks(), 2)
    mock.timers.tick(1000)
    assert.equal(ticks(), 3)
    // ...and a later one ticks at once (in active mode the 1 s timer runs anyway).
    const afterWake = ticks()
    mock.timers.tick(1000)
    setIn(app.tree.electrical, 'motordrive.99.power', leaf(310, Date.now()))
    mock.timers.tick(1000)
    assert.ok(ticks() >= afterWake + 1)
    p.stop()
    const stopped = app.messages.length
    mock.timers.tick(60000)
    assert.equal(app.messages.length, stopped)
  } finally {
    mock.timers.reset()
  }
})

test('a throwing history API does not stop the tick', async () => {
  const app = fakeApp({ getHistoryApi: () => Promise.reject(new Error('no provider')) })
  const p = createPlugin(app)
  p.start({})
  await flush()
  await flush()
  assert.ok(paths(app).includes('plugin.solarsailing.matchState'))
  p.stop()
})

test('a throwing getSelfPath is reported, not thrown', async () => {
  const app = fakeApp({ getSelfPath: () => { throw new Error('boom') } })
  const p = createPlugin(app)
  p.start({})
  await flush()
  await flush()
  assert.ok(app.errors.some((e) => e.includes('boom')))
  p.stop()
})

test('energy seeded from the History API on start', async () => {
  const today = new Date().toISOString().slice(0, 10)
  const app = fakeApp({
    getHistoryApi: async () => ({
      getValues: async () => ({
        values: [{ path: 'plugin.solarsailing.solarEnergyToday' }, { path: 'plugin.solarsailing.motorEnergyToday' }],
        data: [[new Date().toISOString(), 3600000, 360000]]
      })
    })
  })
  const p = createPlugin(app)
  p.start({})
  await flush()
  await flush()
  await flush()
  const status = await app.providers[0].methods.getResource('status')
  assert.equal(status.snapshot.solarEnergyJ, 3600000, `seed on ${today}`)
  p.stop()
})

test('propeller model persisted on stop and reset by config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ss-'))
  const file = join(dir, 'propeller.json')
  const samples = Array.from({ length: 40 }, (_, i) => [220 + i * 8, 0.03 * Math.pow(220 + i * 8, 1.35), i])
  await writeFile(file, JSON.stringify({ samples }))
  const saved = []
  const app = fakeApp({ getDataDirPath: () => dir, savePluginOptions: (o, cb) => { saved.push(o); cb(null) } })
  const p = createPlugin(app)
  p.start({})
  let status
  await waitFor(() => app.messages.length > 1)
  status = await statusOf(app)
  assert.equal(status.propeller.ready, true)
  await p.stop()
  assert.equal(JSON.parse(await readFile(file, 'utf8')).samples.length, 40)

  const before = app.messages.length
  p.start({ resetPropeller: true })
  await waitFor(() => app.messages.length > before + 1)
  status = await statusOf(app)
  assert.equal(status.propeller.samples, 0)
  assert.equal(saved[0].resetPropeller, false)
  await assert.rejects(readFile(file, 'utf8'))
  p.stop()
})

test('forecast: seeded from the tree, then kept from the subscription', async () => {
  const run = Date.parse('2026-11-15T14:15:02.286Z')
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: run + 10 * 60000 })
  try {
    const url = new URL('./fixtures/energy-prediction-2026-11-15.json', import.meta.url)
    const node = JSON.parse(await readFile(url, 'utf8')).electrical.energy.prediction
    // As the server serves it after its 60 s timeout.
    node.forecast.hourly = { value: null, timestamp: node.forecast.hourly.timestamp, state: { timedOut: true, lastValue: node.forecast.hourly.value } }
    const app = fakeApp()
    app.tree['electrical.energy.prediction'] = node
    const p = createPlugin(app)
    p.start({})
    await flush()
    await flush()
    const sub = app.subscriptions.find((x) => x.cmd.subscribe[0].path === 'electrical.energy.prediction.*')
    assert.ok(sub)
    let status = await statusOf(app)
    assert.equal(status.forecast.status, 'stable')
    assert.equal(status.forecast.hours.length > 0, true)
    assert.equal(status.snapshot.forecastBiasW, 0)

    sub.cb({ updates: [{ timestamp: new Date(Date.now()).toISOString(), values: [{ path: 'electrical.energy.prediction.status', value: 'deficit' }] }] })
    sub.cb({ updates: [{ timestamp: new Date(Date.now() + 60000).toISOString(), values: [{ path: 'electrical.energy.prediction.status', value: null }] }] })
    mock.timers.tick(10000)
    status = await statusOf(app)
    assert.equal(status.snapshot.forecastBiasW, -100)
    assert.ok(paths(app).includes('plugin.solarsailing.dayBudget'))
    p.stop()
    assert.deepEqual(app.errors, [])
  } finally {
    mock.timers.reset()
  }
})

test('forecast off: no forecast subscription, no forecast in the status', async () => {
  const app = fakeApp()
  const p = createPlugin(app)
  p.start({ useForecast: false })
  await flush()
  await flush()
  assert.equal(app.subscriptions.some((x) => x.cmd.subscribe[0].path.endsWith('prediction.*')), false)
  assert.equal((await statusOf(app)).forecast, null)
  p.stop()
})

test('config: empty or invalid forecast path falls back to the default', () => {
  assert.equal(resolveConfig({ forecastPath: '' }).config.forecastPath, 'electrical.energy.prediction')
  const { config, warnings } = resolveConfig({ forecastPath: 'a b' })
  assert.equal(config.forecastPath, 'electrical.energy.prediction')
  assert.equal(warnings.length, 1)
  assert.equal(DEFAULTS.sunsetTargetSocPercent, 0)
  assert.equal(DEFAULTS.batteryCapacityWh, 14500)
})

test('speed model persisted next to the propeller and reset by its own flag', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ss-'))
  const file = join(dir, 'speed.json')
  const c = 2.5 / Math.pow(500, 1 / 3)
  const samples = Array.from({ length: 40 }, (_, i) => [100 + i * 40, c * Math.pow(100 + i * 40, 1 / 3), i])
  await writeFile(file, JSON.stringify({ samples, stwRatios: [[1.1]] }))
  const saved = []
  const app = fakeApp({ getDataDirPath: () => dir, savePluginOptions: (o, cb) => { saved.push(o); cb(null) } })
  const p = createPlugin(app)
  p.start({ stwFactor: 1.1 })
  await waitFor(() => app.messages.length > 1)
  let status = await statusOf(app)
  assert.equal(status.speed.ready, true)
  assert.equal(status.speed.samples, 40)
  assert.equal(status.speed.stwFactor, 1.1)
  assert.ok(Math.abs(status.speed.c / c - 1.1) < 1e-6, 'factor applied at fit time')
  assert.equal(status.speed.stwFactorSuggested, null)
  await p.stop()
  const json = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(json.samples, samples, 'samples stay raw')
  assert.deepEqual(json.stwRatios[0], [1.1])

  const before = app.messages.length
  p.start({ resetSpeed: true })
  await waitFor(() => app.messages.length > before + 1)
  status = await statusOf(app)
  assert.equal(status.speed.samples, 0)
  assert.equal(saved[0].resetSpeed, false)
  assert.equal(saved[0].resetPropeller, undefined, 'only the flag that was set')
  await assert.rejects(readFile(file, 'utf8'))
  p.stop()
})

test('navigation state: seeded from the tree, kept from the subscription', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.parse('2026-11-15T12:00:00Z') })
  try {
    const app = fakeApp()
    app.tree['navigation.state'] = { value: null, state: { lastValue: 'sailing' } }
    const p = createPlugin(app)
    p.start({})
    await flush()
    await flush()
    assert.equal((await statusOf(app)).sources.navState, 'sailing')
    const sub = app.subscriptions.find((x) => x.cmd.subscribe[0].path === 'navigation.state')
    assert.ok(sub)
    sub.cb({ updates: [{ values: [{ path: 'navigation.state', value: 'motoring' }] }] })
    sub.cb({ updates: [{ values: [{ path: 'navigation.state', value: null }] }] })
    mock.timers.tick(10000)
    assert.equal((await statusOf(app)).sources.navState, 'motoring', 'the server timeout (null) is ignored')
    p.stop()
    assert.deepEqual(app.errors, [])
  } finally {
    mock.timers.reset()
  }
})
