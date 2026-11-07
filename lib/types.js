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
 *    time?: number, stale: boolean }} BatteryReading
 */

/**
 * @typedef {{ path: string, watts: number, time?: number,
 *    stale: boolean }} PowerReading
 */

/**
 * @typedef {{ solar: SolarReading[], solarFallback: boolean,
 *    motor?: MotorReading, battery?: BatteryReading, dcSystem?: PowerReading,
 *    timezoneOffsetMin?: number }} Readings
 */

/** @typedef {'matched'|'over'|'under'|'unknown'} MatchState */
/** @typedef {'active'|'idle'} Mode */
/** @typedef {'dcSystem'|'balance'|'config'} HouseSource */

/**
 * @typedef {{ t: number, mode: Mode, inDrive: boolean, solarW?: number,
 *    houseW?: number, houseSource: HouseSource, socBiasW: number,
 *    budgetW?: number, motorW?: number, motorSmoothedW?: number,
 *    balanceW?: number, matchState: MatchState, targetRpm?: number,
 *    targetShaftRpm?: number, gearRatio?: number, alarm: boolean,
 *    solarEnergyJ: number, motorEnergyJ: number }} Snapshot
 */

/**
 * Post-MVP hook (ARCHITECTURE 2.7): every output receives each snapshot.
 * @typedef {{ name: string, update(snapshot: Snapshot, now: number): void,
 *    stop(): void }} Output
 */

export {}
