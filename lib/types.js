// Shared JSDoc typedefs (ARCHITECTURE 3). Checked by `tsc --noEmit`.

/**
 * @typedef {{ id: string, path: string, watts: number, via: string,
 *    time?: number, stale: boolean }} SolarReading
 */

/**
 * @typedef {{ id: string, path: string, watts?: number, via?: string,
 *    rpm?: number, direction?: number, gearRatio?: number, inDrive: boolean,
 *    temperatures: Object<string, number>, time?: number,
 *    stale: boolean }} MotorReading
 */

/**
 * @typedef {{ id: string, path: string, soc?: number, watts?: number,
 *    capacityWh?: number, time?: number, stale: boolean }} BatteryReading
 */

/**
 * @typedef {{ path: string, watts: number, time?: number,
 *    stale: boolean }} PowerReading
 */

/** @typedef {{ lat: number, lon: number, time?: number, stale: boolean }} PositionReading */

/** One forecast slot [t, t + 1 h). @typedef {{ t: number, solarWh: number, houseWh: number }} ForecastHour */

/**
 * @typedef {{ time?: number, stale: boolean, hours: ForecastHour[],
 *    status?: 'surplus'|'rising'|'stable'|'deficit'|'critical',
 *    timeToFull?: number, surplusWh?: number,
 *    surplusFrom?: number, surplusTo?: number }} ForecastReading
 */

/** Speed through water, raw (before the STW factor). @typedef {{ mps: number, time?: number, stale: boolean }} SpeedReading */

/** Speed and course over ground. @typedef {{ sog: number, cog: number, time?: number, stale: boolean }} GroundReading */

/** True heading, rad. @typedef {{ rad: number, time?: number, stale: boolean }} HeadingReading */

/**
 * Set (rad, true, direction the current flows to) and drift (m/s).
 * @typedef {{ setTrue: number, drift: number,
 *    source: 'environment'|'estimated' }} CurrentEstimate
 */

/** `environment.current` as published. @typedef {{ setTrue: number, drift: number, time?: number, stale: boolean }} CurrentReading */

/**
 * course-provider distances: to the next point, and to the end of the
 * active route (undefined without a route).
 * @typedef {{ nextM?: number, routeM?: number, bearingTrue?: number,
 *    time?: number, stale: boolean }} CourseReading
 */

/**
 * @typedef {{ solar: SolarReading[], solarFallback: boolean,
 *    motor?: MotorReading, battery?: BatteryReading, dcSystem?: PowerReading,
 *    timezoneOffsetMin?: number, position?: PositionReading,
 *    forecast?: ForecastReading, stw?: SpeedReading, ground?: GroundReading,
 *    navState?: string, course?: CourseReading, heading?: HeadingReading,
 *    current?: CurrentReading }} Readings
 */

/** @typedef {'matched'|'over'|'under'|'unknown'} MatchState */
/** @typedef {'active'|'idle'} Mode */
/** @typedef {'dcSystem'|'balance'|'config'} HouseSource */
/** @typedef {'target'|'neutral'} DayBudgetBasis */
/** @typedef {'dayBudget'|'budget'} RangeBasis */

/**
 * ETA and power needed for one course target (plan 11).
 * `currentCorrected`: ETA and power allow for the current along
 * (`currentAlongMps`, > 0 helps) and across the bearing to the target.
 * @typedef {{ distanceM: number, eta?: number, afterSunset?: boolean,
 *    requiredPowerW?: number, currentCorrected?: boolean,
 *    currentAlongMps?: number, currentAcrossMps?: number }} TargetEstimate
 */

/**
 * @typedef {{ t: number, mode: Mode, inDrive: boolean, solarW?: number,
 *    houseW?: number, houseSource: HouseSource, socBiasW: number,
 *    budgetW?: number, motorW?: number, motorSmoothedW?: number,
 *    balanceW?: number, matchState: MatchState, targetRpm?: number,
 *    targetShaftRpm?: number, gearRatio?: number, alarm: boolean,
 *    solarEnergyJ: number, motorEnergyJ: number, forecastBiasW: number,
 *    sunrise?: number, sunset?: number, dayBudgetW?: number, dayBudgetBasis?: DayBudgetBasis,
 *    sunsetTargetSoc?: number, solarRemainingJ?: number,
 *    houseRemainingJ?: number, bestHours?: { start: number, end: number },
 *    forecastStatus?: string, stw?: number, speedAtBudget?: number,
 *    rangeUntilSunsetM?: number, rangeBasis?: RangeBasis,
 *    waypoint?: TargetEstimate, destination?: TargetEstimate,
 *    current?: CurrentEstimate }} Snapshot
 */

/**
 * Post-MVP hook (ARCHITECTURE 2.7): every output receives each snapshot.
 * @typedef {{ name: string, update(snapshot: Snapshot, now: number): void,
 *    stop(): void }} Output
 */

export {}
