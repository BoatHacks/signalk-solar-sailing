// Advisory output (SPEC 5.1, ARCHITECTURE 2.6): publishes the snapshot on
// plugin.solarsailing.* and raises/clears the over-budget notification.

export const PREFIX = 'plugin.solarsailing.'
export const NOTIFICATION_PATH = 'notifications.solarsailing.overBudget'
export const REFRESH_MS = 5000
/** Seconds after which a published value counts as stale for consumers. */
export const META_TIMEOUT_S = 15

const RPM_TO_HZ = 1 / 60

/** @type {Record<string, { units?: string, description: string, displayUnits?: { category: string, targetUnit: string } }>} */
export const PATH_META = {
  solarPower: { units: 'W', description: 'Solar input', displayUnits: { category: 'power', targetUnit: 'W' } },
  houseLoad: { units: 'W', description: 'House load (DC system, energy balance or configured)', displayUnits: { category: 'power', targetUnit: 'W' } },
  socBias: { units: 'W', description: 'SoC bias applied to the solar budget', displayUnits: { category: 'power', targetUnit: 'W' } },
  budget: { units: 'W', description: 'Solar budget: motor power sustainable on solar (smoothed)', displayUnits: { category: 'power', targetUnit: 'W' } },
  motorPower: { units: 'W', description: 'Motor draw', displayUnits: { category: 'power', targetUnit: 'W' } },
  balance: { units: 'W', description: 'Solar budget minus motor draw', displayUnits: { category: 'power', targetUnit: 'W' } },
  matchState: { description: 'matched / over / under / unknown' },
  targetRevolutions: { units: 'Hz', description: 'Target motor RPM for the solar budget', displayUnits: { category: 'frequency', targetUnit: 'rpm' } },
  targetShaftRevolutions: { units: 'Hz', description: 'Target shaft RPM for the solar budget', displayUnits: { category: 'frequency', targetUnit: 'rpm' } },
  solarEnergyToday: { units: 'J', description: 'Solar energy since local midnight', displayUnits: { category: 'energy', targetUnit: 'Wh' } },
  motorEnergyToday: { units: 'J', description: 'Motor energy since local midnight', displayUnits: { category: 'energy', targetUnit: 'Wh' } }
}

/**
 * Values to publish for a snapshot. Unknown numbers are published as null
 * so consumers see "unknown", never a stale number or 0.
 * @param {import('../types.js').Snapshot} s
 * @returns {Record<string, number | string | null>}
 */
export function snapshotValues (s) {
  /** @param {number | undefined} v @param {number} [digits] */
  const r = (v, digits = 1) => (v === undefined || !Number.isFinite(v) ? null : round(v, digits))
  /** @type {Record<string, number | string | null>} */
  const values = {
    solarPower: r(s.solarW),
    houseLoad: r(s.houseW),
    socBias: r(s.socBiasW),
    budget: r(s.budgetW),
    motorPower: r(s.motorW),
    balance: r(s.balanceW),
    matchState: s.matchState,
    targetRevolutions: s.targetRpm === undefined ? null : r(s.targetRpm * RPM_TO_HZ, 3),
    solarEnergyToday: r(s.solarEnergyJ, 0),
    motorEnergyToday: r(s.motorEnergyJ, 0)
  }
  if (s.gearRatio !== undefined) {
    values.targetShaftRevolutions = s.targetShaftRpm === undefined ? null : r(s.targetShaftRpm * RPM_TO_HZ, 3)
  }
  return values
}

/**
 * @param {number} v
 * @param {number} digits
 */
function round (v, digits) {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}

/**
 * @param {{ handleMessage: Function, setDefaultMetadata?: Function, error?: Function }} app
 * @param {string} pluginId
 * @returns {import('../types.js').Output & { registerMeta(): Promise<void>, sendUnknown(): void }}
 */
export function createAdvisoryOutput (app, pluginId) {
  /** @type {Record<string, number | string | null> | undefined} */
  let lastValues
  let lastSentAt = -Infinity
  let alarmRaised = false

  /** @param {object} update */
  const send = (update) => app.handleMessage(pluginId, { updates: [update] })

  /** @param {boolean} on @param {import('../types.js').Snapshot} [s] */
  const notify = (on, s) => {
    const message = on && s
      ? `Motor ${Math.round(s.motorW || 0)} W is over the solar budget of ${Math.round(s.budgetW || 0)} W`
      : 'Motor draw is back within the solar budget'
    send({
      values: [{
        path: NOTIFICATION_PATH,
        value: { state: on ? 'warn' : 'normal', method: on ? ['visual', 'sound'] : [], message }
      }]
    })
    alarmRaised = on
  }

  return {
    name: 'advisory',

    async registerMeta () {
      send({
        meta: Object.entries(PATH_META).map(([key, m]) => ({
          path: PREFIX + key,
          value: { ...(m.units ? { units: m.units } : {}), description: m.description, timeout: META_TIMEOUT_S }
        }))
      })
      if (typeof app.setDefaultMetadata !== 'function') return
      for (const [key, m] of Object.entries(PATH_META)) {
        if (!m.displayUnits) continue
        try {
          await app.setDefaultMetadata(PREFIX + key, { displayUnits: m.displayUnits })
        } catch (err) {
          if (app.error) app.error(`setDefaultMetadata ${key}: ${/** @type {Error} */ (err).message}`)
        }
      }
    },

    update (snapshot, now) {
      const values = snapshotValues(snapshot)
      const changed = !lastValues || Object.keys(values).some((k) => !lastValues || values[k] !== lastValues[k]) ||
        Object.keys(lastValues).length !== Object.keys(values).length
      if (changed || now - lastSentAt >= REFRESH_MS) {
        send({ values: Object.entries(values).map(([k, v]) => ({ path: PREFIX + k, value: v })) })
        lastValues = values
        lastSentAt = now
      }
      if (snapshot.alarm !== alarmRaised) notify(snapshot.alarm, snapshot)
    },

    sendUnknown () {
      send({ values: [{ path: PREFIX + 'matchState', value: 'unknown' }] })
    },

    stop () {
      if (alarmRaised) notify(false)
      this.sendUnknown()
      lastValues = undefined
      lastSentAt = -Infinity
    }
  }
}
