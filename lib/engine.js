// One snapshot per tick from the readings (ARCHITECTURE 2.3). Stateful, no I/O.

import { Smoother, batteryBias, clamp, verdict } from './matcher.js'
import { EnergyCounter } from './energy.js'
import { PropellerModel } from './propeller.js'

/** @typedef {import('./types.js').Readings} Readings */
/** @typedef {import('./types.js').Snapshot} Snapshot */
/** @typedef {import('./types.js').HouseSource} HouseSource */
/** @typedef {import('./config.js').Config} Config */

export class Engine {
  /**
   * @param {Config} config
   * @param {{ propeller?: PropellerModel }} [deps]
   */
  constructor (config, deps = {}) {
    this.config = config
    this.budgetSmoother = new Smoother(config.smoothingSeconds)
    this.houseSmoother = new Smoother(config.smoothingSeconds)
    this.motorSmoother = new Smoother(config.smoothingSeconds)
    this.solarEnergy = new EnergyCounter()
    this.motorEnergy = new EnergyCounter()
    this.propeller = deps.propeller || new PropellerModel({ fallbackK: config.propellerK, fallbackN: config.propellerN })
    /** @type {import('./types.js').Mode} */
    this.mode = 'idle'
    /** @type {number | undefined} */
    this.lastInDriveAt = undefined
    /** @type {number | undefined} */
    this.overSince = undefined
    /** @type {Snapshot | undefined} */
    this.last = undefined
    /** @type {Readings | undefined} */
    this.lastReadings = undefined
  }

  /**
   * @param {Readings} readings
   * @param {number} now
   * @returns {Snapshot}
   */
  update (readings, now) {
    const c = this.config
    const motor = readings.motor
    const motorW = motor && !motor.stale ? motor.watts : undefined
    const inDrive = Boolean(motor && motor.inDrive)

    // Mode (SPEC 2.6): active while in drive and for idleAfterSeconds after.
    if (inDrive) this.lastInDriveAt = now
    const wasIdle = this.mode === 'idle'
    const motorUsable = motorW !== undefined
    this.mode = inDrive || (motorUsable && this.lastInDriveAt !== undefined && now - this.lastInDriveAt < c.idleAfterSeconds * 1000)
      ? 'active'
      : 'idle'
    if (wasIdle && this.mode === 'active') {
      // Start smoothing from the current sun, not from where it was hours ago.
      this.budgetSmoother.reset()
      this.motorSmoother.reset()
    }

    // 1. Solar
    const fresh = readings.solar.filter((s) => !s.stale)
    const solarW = fresh.length ? fresh.reduce((a, s) => a + s.watts, 0) : undefined

    // 2. House load (SPEC 2.1)
    /** @type {number} */
    let houseRaw
    /** @type {HouseSource} */
    let houseSource
    const dc = readings.dcSystem
    const battery = readings.battery
    if (dc && !dc.stale && (!c.dcSystemIncludesMotor || motorW !== undefined)) {
      houseRaw = c.dcSystemIncludesMotor ? dc.watts - /** @type {number} */ (motorW) : dc.watts
      houseSource = 'dcSystem'
    } else if (solarW !== undefined && battery && battery.watts !== undefined && motorW !== undefined) {
      houseRaw = solarW - battery.watts - motorW
      houseSource = 'balance'
    } else {
      houseRaw = c.fallbackHouseLoadW
      houseSource = 'config'
    }
    const houseW = Math.max(0, /** @type {number} */ (this.houseSmoother.update(Math.max(0, houseRaw), now)))

    // 3. SoC bias (SPEC 2.2)
    const soc = battery && battery.soc !== undefined ? battery.soc * 100 : undefined
    const socBiasW = batteryBias(soc, {
      socLow: c.socLowPercent,
      socHigh: c.socHighPercent,
      chargeReserveW: c.chargeReserveW,
      batteryAssistW: c.batteryAssistW
    })

    // 4. Budget: smoothed while active, raw while idle (smoother paused).
    const hi = c.maxMotorPowerW > 0 ? c.maxMotorPowerW : Infinity
    let budgetW
    if (solarW !== undefined) {
      const raw = solarW - houseW + socBiasW
      const value = this.mode === 'active' ? this.budgetSmoother.update(raw, now) : raw
      budgetW = value === undefined ? undefined : clamp(value, 0, hi)
    }
    const motorSmoothedW = this.mode === 'active' ? this.motorSmoother.update(motorW, now) : motorW

    // 5. Balance and match state (SPEC 2.3)
    const balanceW = budgetW !== undefined && motorW !== undefined ? budgetW - motorW : undefined
    const matchState = this.mode === 'active' && inDrive ? verdict(motorW, budgetW) : 'unknown'

    // 6. Target RPM
    if (this.mode === 'active' && motor) this.propeller.observe(motor.rpm, motorW, inDrive, now)
    const targetRpm = this.propeller.targetRpm(budgetW)
    const gearRatio = motor ? motor.gearRatio : undefined
    const targetShaftRpm = targetRpm !== undefined && gearRatio !== undefined ? targetRpm / gearRatio : undefined

    // 7. Over-budget timer
    if (matchState === 'over') {
      if (this.overSince === undefined) this.overSince = now
    } else {
      this.overSince = undefined
    }
    const alarm = this.overSince !== undefined && now - this.overSince >= c.overBudgetDelaySeconds * 1000

    // Energy today
    const tz = readings.timezoneOffsetMin
    const solarEnergyJ = this.solarEnergy.add(solarW, now, tz)
    const motorEnergyJ = this.motorEnergy.add(motorW, now, tz)

    /** @type {Snapshot} */
    const snapshot = {
      t: now,
      mode: this.mode,
      inDrive,
      solarW,
      houseW,
      houseSource,
      socBiasW,
      budgetW,
      motorW,
      motorSmoothedW,
      balanceW,
      matchState,
      targetRpm,
      targetShaftRpm,
      gearRatio,
      alarm,
      solarEnergyJ,
      motorEnergyJ
    }
    this.last = snapshot
    this.lastReadings = readings
    return snapshot
  }

  /**
   * Continue today's energy from History API values.
   * @param {{ solarJ?: number, motorJ?: number }} seed
   * @param {number} now
   * @param {number} [offsetMin]
   */
  seedEnergy (seed, now, offsetMin) {
    if (seed.solarJ !== undefined) this.solarEnergy.seed(seed.solarJ, now, offsetMin)
    if (seed.motorJ !== undefined) this.motorEnergy.seed(seed.motorJ, now, offsetMin)
  }
}
