// Turns the Signal K data tree into Readings once per tick (SPEC 4,
// ARCHITECTURE 2.2). Pure: the caller passes the tree, so tests use plain
// objects.

import { finite, getIn, leafValue, leafTime, motorPowerFromNode, powerFromPath, readLeaf, solarPowerFromNode } from './power.js'

/** @typedef {import('./types.js').Readings} Readings */
/** @typedef {import('./types.js').SolarReading} SolarReading */
/** @typedef {import('./types.js').MotorReading} MotorReading */
/** @typedef {import('./types.js').BatteryReading} BatteryReading */
/** @typedef {import('./config.js').Config} Config */

export const SOLAR_FALLBACK_PATH = 'electrical.venus.totalPanelPower'

/**
 * @param {number | undefined} time
 * @param {number} now
 * @param {number} staleSeconds
 */
export function isStale (time, now, staleSeconds) {
  return time === undefined || now - time > staleSeconds * 1000
}

/**
 * @param {unknown} node
 * @returns {[string, unknown][]}
 */
function children (node) {
  if (!node || typeof node !== 'object') return []
  return Object.entries(node).filter(([k, v]) => v && typeof v === 'object' && k !== 'meta' && k !== 'value' && k !== 'values')
}

/**
 * @param {unknown} tree
 * @param {Config} config
 * @param {number} now
 * @returns {SolarReading[]}
 */
function readChargers (tree, config, now) {
  const base = config.solarPath || 'electrical.solar'
  /** @type {SolarReading[]} */
  const out = []
  if (config.solarPath) {
    // An override may point at one charger or a single value instead of a parent.
    const node = getIn(tree, base)
    const single = finite(leafValue(node)) ? powerFromPath(tree, base, 'solar') : solarPowerFromNode(node)
    if (single) {
      out.push({ id: base.split('.').pop() || base, path: base, ...single, stale: isStale(single.time, now, config.staleSeconds) })
      return out
    }
  }
  for (const [id, node] of children(getIn(tree, base))) {
    const p = solarPowerFromNode(node)
    if (p) out.push({ id, path: `${base}.${id}`, ...p, stale: isStale(p.time, now, config.staleSeconds) })
  }
  return out
}

/**
 * Sum of chargers; the Cerbo total only when no charger is fresh.
 * @param {unknown} tree
 * @param {Config} config
 * @param {number} now
 * @returns {{ solar: SolarReading[], solarFallback: boolean }}
 */
export function readSolar (tree, config, now) {
  const chargers = readChargers(tree, config, now)
  if (chargers.some((c) => !c.stale)) return { solar: chargers, solarFallback: false }
  const total = config.solarPath ? undefined : powerFromPath(tree, SOLAR_FALLBACK_PATH, 'solar')
  if (total && !isStale(total.time, now, config.staleSeconds)) {
    return {
      solar: [{ id: 'total', path: SOLAR_FALLBACK_PATH, watts: total.watts, via: 'totalPanelPower', time: total.time, stale: false }],
      solarFallback: true
    }
  }
  return { solar: chargers, solarFallback: false }
}

/**
 * Motor power, propulsion values and the in-drive flag (SPEC 2.3).
 * @param {unknown} tree
 * @param {Config} config
 * @param {number} now
 * @returns {MotorReading | undefined}
 */
export function readMotor (tree, config, now) {
  let id
  let path
  let power
  if (config.motorPowerPath) {
    path = config.motorPowerPath
    id = path.split('.').pop() || path
    power = powerFromPath(tree, path, 'motor')
  } else {
    for (const [k, node] of children(getIn(tree, 'electrical.motordrive'))) {
      const p = motorPowerFromNode(node)
      if (p) {
        id = k
        path = `electrical.motordrive.${k}`
        power = p
        break
      }
    }
  }

  const prop = getIn(tree, config.propulsionPath)
  const fresh = (/** @type {string} */ key) => {
    const leaf = getIn(prop, key)
    const v = leafValue(leaf)
    return v !== undefined && !isStale(leafTime(leaf), now, config.staleSeconds) ? v : undefined
  }
  const hz = fresh('revolutions')
  const direction = fresh('direction')
  // The gear ratio is static configuration (baseDeltas.json), so it is never stale.
  const ratio = leafValue(getIn(prop, 'transmission.gearRatio'))
  /** @type {Object<string, number>} */
  const temperatures = {}
  for (const key of ['temperature', 'controllerTemperature']) {
    const v = fresh(key)
    if (v !== undefined) temperatures[key] = v
  }

  if (!power && hz === undefined && direction === undefined) return undefined

  const stale = !power || isStale(power.time, now, config.staleSeconds)
  const watts = power && !stale ? power.watts : undefined
  const inDrive = watts !== undefined && watts > config.idlePowerW && (direction === undefined || direction !== 0)
  return {
    id: id || config.propulsionPath,
    path: path || config.propulsionPath,
    watts,
    via: power ? power.via : undefined,
    rpm: hz === undefined ? undefined : hz * 60,
    direction,
    gearRatio: finite(ratio) && ratio > 0 ? ratio : undefined,
    inDrive,
    temperatures,
    time: power ? power.time : undefined,
    stale
  }
}

/**
 * Battery SoC (ratio) and power (charging positive after the sign setting).
 * @param {unknown} tree
 * @param {Config} config
 * @param {number} now
 * @returns {BatteryReading | undefined}
 */
export function readBattery (tree, config, now) {
  let path = config.batteryPath
  if (!path && config.batteryId) path = `electrical.batteries.${config.batteryId}`
  if (!path) {
    const first = children(getIn(tree, 'electrical.batteries'))
      .find(([, node]) => leafValue(getIn(node, 'stateOfCharge')) !== undefined || motorPowerFromNode(node))
    if (!first) return undefined
    path = `electrical.batteries.${first[0]}`
  }
  const node = getIn(tree, path)
  if (!node || typeof node !== 'object') return undefined

  const socLeaf = getIn(node, 'stateOfCharge')
  const socTime = leafTime(socLeaf)
  const soc = isStale(socTime, now, config.staleSeconds) ? undefined : leafValue(socLeaf)

  let watts
  let wattsTime
  const p = /** @type {any} */ (node).power
  const pv = leafValue(p)
  if (pv !== undefined) {
    watts = pv
    wattsTime = leafTime(p)
  } else {
    const v = leafValue(/** @type {any} */ (node).voltage)
    const i = leafValue(/** @type {any} */ (node).current)
    if (v !== undefined && i !== undefined) {
      watts = v * i
      wattsTime = leafTime(/** @type {any} */ (node).current)
    }
  }
  if (watts !== undefined && isStale(wattsTime, now, config.staleSeconds)) watts = undefined
  if (watts !== undefined && config.invertBatteryPower) watts = -watts

  const time = Math.max(socTime || 0, wattsTime || 0) || undefined
  return {
    id: path.split('.').pop() || path,
    path,
    soc,
    watts,
    time,
    stale: soc === undefined && watts === undefined
  }
}

/**
 * `environment.time.timezoneOffset` is `(-)hhmm` (e.g. 200, -930, "0").
 * @param {unknown} v
 * @returns {number | undefined} offset in minutes
 */
export function parseTimezoneOffset (v) {
  const raw = v && typeof v === 'object' ? /** @type {any} */ (v).value : v
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (!finite(n)) return undefined
  const sign = n < 0 ? -1 : 1
  const abs = Math.abs(Math.trunc(n))
  const minutes = Math.floor(abs / 100) * 60 + (abs % 100)
  if (minutes > 14 * 60) return undefined
  return sign * minutes
}

/**
 * Everything the engine needs for one tick.
 * @param {unknown} tree self vessel subtree
 * @param {Config} config
 * @param {number} now ms since epoch
 * @returns {Readings}
 */
export function readSources (tree, config, now) {
  const { solar, solarFallback } = readSolar(tree, config, now)
  const dc = readLeaf(tree, config.dcSystemPowerPath)
  return {
    solar,
    solarFallback,
    motor: readMotor(tree, config, now),
    battery: readBattery(tree, config, now),
    dcSystem: dc
      ? { path: config.dcSystemPowerPath, watts: dc.value, time: dc.time, stale: isStale(dc.time, now, config.staleSeconds) }
      : undefined,
    timezoneOffsetMin: parseTimezoneOffset(getIn(tree, 'environment.time.timezoneOffset'))
  }
}
