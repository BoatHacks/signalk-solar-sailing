// Plugin configuration: JSON schema shown in the admin UI, defaults (SPEC 8)
// and validation of user-entered paths (ARCHITECTURE 6).

/** Signal K paths entered by the user must match this before use. */
export const PATH_RE = /^[A-Za-z0-9_.]+$/

/**
 * @typedef {Object} Config
 * @property {string} propulsionPath
 * @property {string} solarPath
 * @property {string} motorPowerPath
 * @property {string} batteryId
 * @property {string} batteryPath
 * @property {boolean} invertBatteryPower
 * @property {string} dcSystemPowerPath
 * @property {boolean} dcSystemIncludesMotor
 * @property {number} fallbackHouseLoadW
 * @property {number} maxMotorPowerW
 * @property {number} forwardDirection
 * @property {number} socLowPercent
 * @property {number} socHighPercent
 * @property {number} chargeReserveW
 * @property {number} batteryAssistW
 * @property {number} smoothingSeconds
 * @property {number} staleSeconds
 * @property {number} overBudgetDelaySeconds
 * @property {number} idlePowerW
 * @property {number} idleAfterSeconds
 * @property {number} idleTickSeconds
 * @property {number} propellerK
 * @property {number} propellerN
 * @property {boolean} resetPropeller
 */

/** @type {Config} */
export const DEFAULTS = Object.freeze({
  propulsionPath: 'propulsion.main',
  solarPath: '',
  motorPowerPath: '',
  batteryId: '',
  batteryPath: '',
  invertBatteryPower: false,
  dcSystemPowerPath: 'electrical.venus.dcPower',
  dcSystemIncludesMotor: true,
  fallbackHouseLoadW: 0,
  maxMotorPowerW: 0,
  forwardDirection: 0,
  socLowPercent: 50,
  socHighPercent: 90,
  chargeReserveW: 100,
  batteryAssistW: 0,
  smoothingSeconds: 30,
  staleSeconds: 10,
  overBudgetDelaySeconds: 60,
  idlePowerW: 15,
  idleAfterSeconds: 30,
  idleTickSeconds: 10,
  propellerK: 0,
  propellerN: 3,
  resetPropeller: false
})

const pathField = (title, description) => ({
  type: 'string',
  title,
  description,
  pattern: '^[A-Za-z0-9_.]*$'
})

const num = (title, description, minimum, maximum) => {
  /** @type {Record<string, unknown>} */
  const f = { type: 'number', title, description }
  if (minimum !== undefined) f.minimum = minimum
  if (maximum !== undefined) f.maximum = maximum
  return f
}

/** JSON schema for the admin UI. Every field has a default (registry check). */
export function schema () {
  /** @type {Record<string, Record<string, unknown>>} */
  const properties = {
    propulsionPath: pathField('Propulsion path',
      'Subtree with revolutions, direction, temperatures and transmission.gearRatio. The venus plugin publishes the Curtis as propulsion.99.'),
    solarPath: pathField('Solar path override',
      'Empty: sum every electrical.solar.* charger. Otherwise a parent of solar chargers, one charger, or a single power value.'),
    motorPowerPath: pathField('Motor power path override',
      'Empty: first electrical.motordrive.* found. Otherwise a node with power (or voltage and current), or a power value.'),
    batteryId: { type: 'string', title: 'Battery bank id', description: 'Id under electrical.batteries. Empty: first one found.' },
    batteryPath: pathField('Battery path override', 'Full path of the battery node; takes precedence over the bank id.'),
    invertBatteryPower: { type: 'boolean', title: 'Invert battery power sign', description: 'Tick if your battery monitor reports charging as negative.' },
    dcSystemPowerPath: pathField('DC system power path', 'House load source, the Cerbo\'s /Dc/System/Power. Empty to skip.'),
    dcSystemIncludesMotor: { type: 'boolean', title: 'DC system power includes the motor', description: 'On: house load = DC system power − motor. Off: house load = DC system power.' },
    fallbackHouseLoadW: num('Fallback house load (W)', 'Used when neither DC system power nor the battery balance is available.', 0),
    maxMotorPowerW: num('Max motor power (W)', '0 = no upper clamp on the budget.', 0),
    forwardDirection: num('Forward direction value', 'Value of the propulsion direction that means forward. 0 = not set.'),
    socLowPercent: num('SoC low (%)', 'At or below this SoC the full charge reserve is held back.', 0, 100),
    socHighPercent: num('SoC high (%)', 'At or above this SoC the battery may assist.', 0, 100),
    chargeReserveW: num('Charge reserve (W)', 'Power held back for charging when the bank is low.', 0),
    batteryAssistW: num('Battery assist (W)', 'Power the battery may add when it is nearly full.', 0),
    smoothingSeconds: num('Smoothing time constant (s)', 'Exponential smoothing of the budget and house load.', 0),
    staleSeconds: num('Stale after (s)', 'Values older than this are ignored.', 1),
    overBudgetDelaySeconds: num('Over-budget delay (s)', 'How long the motor must be over budget before the notification.', 0),
    idlePowerW: num('Idle power threshold (W)', 'Motor counts as in drive above this power.', 0),
    idleAfterSeconds: num('Idle after (s)', 'Switch to the slow tick after the motor has been out of drive this long.', 0),
    idleTickSeconds: num('Idle tick interval (s)', 'Calculation interval while idle.', 1, 60),
    propellerK: num('Propeller k fallback', 'P = k · rpm^n, used until the model is learned. 0 = none (target RPM hidden).', 0),
    propellerN: num('Propeller n fallback', 'Exponent used until enough samples span a wide RPM range.', 1, 3.5),
    resetPropeller: { type: 'boolean', title: 'Reset learned propeller', description: 'Clears the learned model on the next start (for example after a prop change), then unticks itself.' }
  }
  for (const [key, value] of Object.entries(DEFAULTS)) properties[key].default = value
  return {
    type: 'object',
    title: 'Solar Sailing',
    description: 'Matches electric motor draw to solar input. Advisory only: it never commands the motor.',
    properties
  }
}

/**
 * Merge user options over the defaults. Wrong types fall back to the default;
 * invalid paths are replaced by the default (or '' for overrides) and reported.
 * @param {Record<string, unknown>} [options]
 * @returns {{ config: Config, warnings: string[] }}
 */
export function resolveConfig (options) {
  const opts = options && typeof options === 'object' ? options : {}
  /** @type {Record<string, unknown>} */
  const out = {}
  const warnings = []
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const v = opts[key]
    if (typeof def === 'number') {
      out[key] = typeof v === 'number' && Number.isFinite(v) ? v : def
    } else if (typeof def === 'boolean') {
      out[key] = typeof v === 'boolean' ? v : def
    } else {
      out[key] = typeof v === 'string' ? v.trim() : def
    }
  }
  for (const key of ['propulsionPath', 'solarPath', 'motorPowerPath', 'batteryPath', 'dcSystemPowerPath']) {
    const v = /** @type {string} */ (out[key])
    if (v !== '' && !PATH_RE.test(v)) {
      warnings.push(`Ignoring invalid ${key} "${v}"`)
      out[key] = key === 'propulsionPath' ? DEFAULTS.propulsionPath : ''
    }
  }
  if (out.batteryId !== '' && !PATH_RE.test(/** @type {string} */ (out.batteryId))) {
    warnings.push(`Ignoring invalid batteryId "${out.batteryId}"`)
    out.batteryId = ''
  }
  if (/** @type {number} */ (out.socHighPercent) <= /** @type {number} */ (out.socLowPercent)) {
    warnings.push('socHighPercent must be above socLowPercent; using defaults')
    out.socLowPercent = DEFAULTS.socLowPercent
    out.socHighPercent = DEFAULTS.socHighPercent
  }
  return { config: /** @type {Config} */ (out), warnings }
}
