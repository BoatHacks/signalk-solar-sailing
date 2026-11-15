// One snapshot per tick from the readings (ARCHITECTURE 2.3). Stateful, no I/O.

import { Smoother, batteryBias, clamp, verdict } from './matcher.js'
import { EnergyCounter } from './energy.js'
import { PropellerModel } from './propeller.js'
import { bestHours, dayBudget, forecastBias, forecastSunTimes, nightHouseWh, remainingUntil, sunsetTarget, HOUR_MS } from './forecast.js'
import { dayStart, sunTimes } from './sun.js'

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
    // A motor that publishes nothing at all (controller powered down, its
    // paths gone or nulled) draws nothing, so house load can still be derived.
    // A motor that is present but stale stays unknown.
    const motorDrawW = motorW !== undefined ? motorW : (motor === undefined ? 0 : undefined)
    if (dc && !dc.stale && (!c.dcSystemIncludesMotor || motorDrawW !== undefined)) {
      houseRaw = c.dcSystemIncludesMotor ? dc.watts - /** @type {number} */ (motorDrawW) : dc.watts
      houseSource = 'dcSystem'
    } else if (solarW !== undefined && battery && battery.watts !== undefined && motorDrawW !== undefined) {
      houseRaw = solarW - battery.watts - motorDrawW
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
    // Plus the forecast bias (plan 10): 0 without a fresh forecast.
    const forecast = readings.forecast && !readings.forecast.stale ? readings.forecast : undefined
    const forecastBiasW = forecastBias(forecast, now, soc, c)

    // 4. Budget: smoothed while active, raw while idle (smoother paused).
    const hi = c.maxMotorPowerW > 0 ? c.maxMotorPowerW : Infinity
    let budgetW
    if (solarW !== undefined) {
      const raw = solarW - houseW + socBiasW + forecastBiasW
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
    const day = this.solarDay(readings, forecast, soc, socBiasW, now)
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
      motorEnergyJ,
      forecastBiasW,
      ...day
    }
    this.last = snapshot
    this.lastReadings = readings
    return snapshot
  }

  /**
   * Sunset, day budget and best hours (plan 10). Computed in both modes, so
   * the day budget shows before the motor starts. Advice only: the match
   * state stays against the live budget.
   * @param {Readings} readings
   * @param {import('./types.js').ForecastReading | undefined} forecast fresh forecast
   * @param {number | undefined} soc percent
   * @param {number} socBiasW
   * @param {number} now
   */
  solarDay (readings, forecast, soc, socBiasW, now) {
    const c = this.config
    const day0 = dayStart(now, readings.timezoneOffsetMin)
    const pos = readings.position && !readings.position.stale ? readings.position : undefined
    const hours = forecast ? forecast.hours : []
    /** @type {number | undefined} */
    let sunset
    /** @type {number | undefined} */
    let nextSunrise
    /** @type {number | undefined} end of the solar day for the budget */
    let end
    if (pos) {
      const today = sunTimes(pos.lat, pos.lon, day0)
      if (today.alwaysUp) {
        end = hours.length ? hours[hours.length - 1].t + HOUR_MS : day0 + 24 * HOUR_MS
      } else if (today.sunset !== undefined) {
        sunset = today.sunset
        nextSunrise = sunTimes(pos.lat, pos.lon, day0 + 24 * HOUR_MS).sunrise
      }
    } else if (forecast) {
      ({ sunset, nextSunrise } = forecastSunTimes(hours, day0))
    }
    if (end === undefined) end = sunset

    const battery = readings.battery
    const capacityWh = c.batteryCapacityWh > 0 ? c.batteryCapacityWh : (battery ? battery.capacityWh : undefined)
    const nightWh = forecast && sunset !== undefined && nextSunrise !== undefined
      ? nightHouseWh(hours, sunset, nextSunrise)
      : undefined
    const target = sunsetTarget(c, nightWh, capacityWh)

    /** @type {Partial<Snapshot>} */
    const out = { sunset, sunsetTargetSoc: target }
    if (forecast) {
      out.forecastStatus = forecast.status
      if (end !== undefined && end > now) {
        const rem = remainingUntil(hours, now, end)
        out.solarRemainingJ = rem.solarWh * 3600
        out.houseRemainingJ = rem.houseWh * 3600
        const db = dayBudget(rem, now, end, {
          soc: soc === undefined ? undefined : soc / 100,
          target,
          capacityWh,
          socBiasW,
          maxMotorPowerW: c.maxMotorPowerW
        })
        if (db) {
          out.dayBudgetW = db.watts
          out.dayBudgetBasis = db.basis
        }
        out.bestHours = bestHours(hours, now, end, c.bestHoursWindowH)
      }
    }
    return out
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
