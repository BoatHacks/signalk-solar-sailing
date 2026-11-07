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
