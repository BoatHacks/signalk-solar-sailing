// Plugin entry: lifecycle and tick scheduler (ARCHITECTURE 2.1).
// Only this file, lib/outputs/, lib/resources.js and lib/history.js touch `app`.

import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveConfig, schema } from './lib/config.js'
import { readSources } from './lib/sources.js'
import { Engine } from './lib/engine.js'
import { PropellerModel } from './lib/propeller.js'
import { loadEnergySeed } from './lib/history.js'
import { createAdvisoryOutput } from './lib/outputs/advisory.js'
import { RESOURCE_TYPE, buildStatus, resourceMethods } from './lib/resources.js'

export const PLUGIN_ID = 'signalk-solar-sailing'
export const ACTIVE_TICK_MS = 1000
export const PROPELLER_SAVE_MS = 5 * 60 * 1000
export const SEED_TIMEOUT_MS = 5000
const PROPELLER_FILE = 'propeller.json'

/**
 * @param {any} app Signal K server API
 */
export default function solarSailing (app) {
  /** @type {any} */
  let state
  /** Saves run one after another, and start waits for the last one. */
  let saving = Promise.resolve()

  /** @param {string} msg */
  const error = (msg) => { if (app.error) app.error(msg) }
  /** @param {string} msg */
  const debug = (msg) => { if (app.debug) app.debug(msg) }

  /**
   * Run `fn`, reporting instead of throwing, so one failing step never stops
   * the tick.
   * @template T
   * @param {string} step
   * @param {() => T} fn
   * @returns {T | undefined}
   */
  const guard = (step, fn) => {
    try {
      return fn()
    } catch (err) {
      error(`${step}: ${/** @type {Error} */ (err).message}`)
      return undefined
    }
  }

  const plugin = {
    id: PLUGIN_ID,
    name: 'Solar Sailing',
    description: 'Matches electric motor draw to solar input: solar budget, match state and target RPM (advisory).',
    schema,

    /** @param {Record<string, unknown>} options */
    start (options) {
      if (state) plugin.stop()
      const { config, warnings } = resolveConfig(options)
      for (const w of warnings) error(w)

      const propeller = new PropellerModel({ fallbackK: config.propellerK, fallbackN: config.propellerN })
      const engine = new Engine(config, { propeller })
      const advisory = createAdvisoryOutput(app, PLUGIN_ID)
      /** @type {any} */
      const s = state = {
        config,
        engine,
        propeller,
        outputs: [advisory],
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        timer: undefined,
        /** @type {ReturnType<typeof setInterval> | undefined} */
        saveTimer: undefined,
        /** @type {Array<() => void>} */
        unsubscribes: [],
        running: true,
        ticking: false,
        wakePending: false,
        lastTickAt: 0
      }

      const dataDir = guard('data dir', () => (typeof app.getDataDirPath === 'function' ? app.getDataDirPath() : undefined))
      s.propellerFile = dataDir ? join(dataDir, PROPELLER_FILE) : undefined

      guard('metadata', () => { advisory.registerMeta().catch((err) => error(`metadata: ${err.message}`)) })

      guard('resource provider', () => {
        if (typeof app.registerResourceProvider !== 'function') return
        app.registerResourceProvider({
          type: RESOURCE_TYPE,
          methods: resourceMethods(() => buildStatus(engine.last, engine.lastReadings, {
            k: propeller.k,
            n: propeller.n,
            samples: propeller.samples.length,
            ready: propeller.ready
          }))
        })
      })

      guard('wake subscription', () => subscribeWake(s))

      s.saveTimer = setInterval(() => { saveModel(s) }, PROPELLER_SAVE_MS)
      if (s.saveTimer.unref) s.saveTimer.unref()

      // Load the learned model and today's energy, then start the tick. Both are
      // best effort: without a data dir or history provider the plugin still runs.
      init(s, options).finally(() => {
        if (s.running) tick(s)
      })
      if (app.setPluginStatus) app.setPluginStatus('Started')
    },

    stop () {
      const s = state
      state = undefined
      if (!s) return
      s.running = false
      if (s.timer) clearTimeout(s.timer)
      if (s.saveTimer) clearInterval(s.saveTimer)
      for (const u of s.unsubscribes) guard('unsubscribe', u)
      s.unsubscribes = []
      for (const o of s.outputs) guard(`${o.name} stop`, () => o.stop())
      return saveModel(s)
    }
  }

  /**
   * @param {any} s
   * @param {Record<string, unknown>} options
   */
  async function init (s, options) {
    const { config, propeller, engine } = s
    await saving
    if (s.propellerFile) {
      if (config.resetPropeller) {
        await rm(s.propellerFile, { force: true }).catch((err) => error(`propeller reset: ${err.message}`))
        if (typeof app.savePluginOptions === 'function') {
          app.savePluginOptions({ ...options, resetPropeller: false }, (/** @type {any} */ err) => {
            if (err) error(`savePluginOptions: ${err.message}`)
          })
        }
        debug('Learned propeller model reset')
      } else {
        try {
          propeller.load(JSON.parse(await readFile(s.propellerFile, 'utf8')))
          debug(`Propeller model loaded: ${propeller.samples.length} samples`)
        } catch (err) {
          if (/** @type {any} */ (err).code !== 'ENOENT') error(`propeller load: ${/** @type {Error} */ (err).message}`)
        }
      }
    }
    try {
      const now = Date.now()
      const tz = readSources(readTree(config), config, now).timezoneOffsetMin
      const getHistoryApi = typeof app.getHistoryApi === 'function' ? () => app.getHistoryApi() : undefined
      /** @type {Promise<{ solarJ?: number, motorJ?: number }>} */
      const timeout = new Promise((resolve) => { setTimeout(() => resolve({}), SEED_TIMEOUT_MS).unref() })
      const seed = await Promise.race([loadEnergySeed(getHistoryApi, now, tz), timeout])
      if (s.running) engine.seedEnergy(seed, Date.now(), tz)
      if (seed.solarJ !== undefined || seed.motorJ !== undefined) debug(`Energy seeded from history: ${JSON.stringify(seed)}`)
    } catch (err) {
      error(`energy seed: ${/** @type {Error} */ (err).message}`)
    }
  }

  /**
   * Write to a temporary file and rename it, so a restart or crash never
   * leaves a half-written model behind.
   * @param {any} s
   * @returns {Promise<void>}
   */
  function saveModel (s) {
    if (!s.propellerFile || s.propeller.samples.length === 0) return saving
    const file = s.propellerFile
    const json = JSON.stringify(s.propeller.toJSON())
    saving = saving.then(async () => {
      try {
        await writeFile(`${file}.tmp`, json)
        await rename(`${file}.tmp`, file)
      } catch (err) {
        error(`propeller save: ${/** @type {Error} */ (err).message}`)
      }
    })
    return saving
  }

  /**
   * The self-vessel subtrees the sources need.
   * @param {import('./lib/config.js').Config} config
   */
  function readTree (config) {
    const roots = new Set(['electrical', 'environment'])
    for (const p of [config.propulsionPath, config.solarPath, config.motorPowerPath, config.batteryPath, config.dcSystemPowerPath]) {
      if (p) roots.add(p.split('.')[0])
    }
    /** @type {Record<string, unknown>} */
    const tree = {}
    for (const root of roots) {
      const sub = app.getSelfPath(root)
      if (sub !== undefined) tree[root] = sub
    }
    return tree
  }

  /** @param {any} s */
  function tick (s) {
    if (!s.running || s.ticking) return
    s.ticking = true
    if (s.timer) clearTimeout(s.timer)
    s.timer = undefined
    s.wakePending = false
    const now = Date.now()
    s.lastTickAt = now
    try {
      const readings = guard('read sources', () => readSources(readTree(s.config), s.config, now))
      const snapshot = readings && guard('engine', () => s.engine.update(readings, now))
      if (snapshot) {
        for (const o of s.outputs) guard(`${o.name} output`, () => o.update(snapshot, now))
      }
    } finally {
      s.ticking = false
      if (s.running) {
        const ms = s.engine.mode === 'active' ? ACTIVE_TICK_MS : s.config.idleTickSeconds * 1000
        s.timer = setTimeout(() => tick(s), ms)
      }
    }
  }

  /**
   * While idle, motor deltas only wake the tick; values are still read from
   * the tree, so duplicate deltas stay harmless.
   * @param {any} s
   */
  function subscribeWake (s) {
    if (!app.subscriptionmanager || typeof app.subscriptionmanager.subscribe !== 'function') return
    const motorPath = s.config.motorPowerPath || 'electrical.motordrive.*'
    app.subscriptionmanager.subscribe(
      {
        context: 'vessels.self',
        subscribe: [
          { path: motorPath, policy: 'instant', minPeriod: 1000 },
          { path: `${s.config.propulsionPath}.direction`, policy: 'instant', minPeriod: 1000 }
        ]
      },
      s.unsubscribes,
      (/** @type {any} */ err) => error(`subscription: ${err}`),
      () => {
        if (!s.running || s.ticking || s.engine.mode === 'active' || s.wakePending) return
        const readings = guard('wake read', () => readSources(readTree(s.config), s.config, Date.now()))
        if (!readings || !readings.motor || !readings.motor.inDrive) return
        // At most one tick per second: if one just ran, bring the next one forward.
        const wait = s.lastTickAt + ACTIVE_TICK_MS - Date.now()
        if (wait <= 0) {
          tick(s)
          return
        }
        if (s.timer) clearTimeout(s.timer)
        s.wakePending = true
        s.timer = setTimeout(() => { s.wakePending = false; tick(s) }, wait)
      }
    )
  }

  return plugin
}
