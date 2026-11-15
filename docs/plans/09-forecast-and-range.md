# Implementation Plan: Solar forecast and range estimate (shared design)

## Overview
The two remaining planning items from SPEC 9.2, taken together because both
need the same three things: **when is sunset**, **how much energy is left
until then**, and **what motor power that allows**. The forecast turns the
live budget into a day budget; the range estimate turns a budget into speed
and distance.

This file is the shared design: data flow, the sun calculation, new readings,
paths and config. The build is three plans, each one PR:

| # | Plan | Delivers | Depends on |
|---|------|----------|------------|
| 10 | [Sun and forecast](10-sun-and-forecast.md) | sunset, day budget, forecast bias, best hours | 9 (this design) |
| 11 | [Range and speed](11-range.md) | learned speed model, speed at budget, range until sunset, waypoint ETA | 10 (sunset, day budget) |
| 12 | [Webapp: forecast and range](12-forecast-range-webapp.md) | day budget, best hours, forecast curve, range panel | 10, 11 |

Plan 11 still works without plan 10's forecast (it falls back to the live
budget), but it needs plan 10's `lib/sun.js` for the sunset time.

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 2.2 (SoC bias), 2.6 (active/idle), 4 (sources, staleness), 5.1 (paths),
  7 (persistence), 9.2 (the two items), 9.3 (registry: `recommends`, no network),
  11 (design decisions), 12
- ARCHITECTURE 2.2 (sources), 2.3 (engine), 2.4 (propeller learning, reused),
  2.6 (advisory metadata), 2.8 (resources), 9 (future considerations)

## Ground rules carried over (SPEC 11, project decisions)
- **Works unchanged without a forecast**, without position, without speed
  through water. Each missing input only hides the values that need it;
  nothing that works today changes. With default config and no data,
  `start()` and the tick behave exactly as now (registry harness, SPEC 9.3).
- **Missing means unknown, never 0.** A stale forecast is ignored, not read
  as "no sun". Unknown values publish `null`.
- **Read on the tick, don't count deltas**, with one exception: the boat
  server nulls paths 60 s after their last update and the predictor
  publishes hourly, so the forecast and `navigation.state` are kept from a
  subscription in a last-value cache that the tick reads (plan 10).
- **`lib/` stays I/O-free.** New maths modules take plain values and `now`.
- **Zero runtime dependencies.** The sun position is about 40 lines of the
  NOAA algorithm, not a library (signalk-energy-predictor uses
  `@openwaters/almanac`; we don't take it).
- **No network at runtime.** The forecast comes from another plugin's
  Signal K paths; we never fetch weather ourselves.
- **All outputs under `plugin.solarsailing.*`**, flat SI values with
  `meta.units` and `displayUnits`, like the MVP paths.

## Data flow

```
 navigation.position ─────────┐
 electrical.energy.prediction.*  (signalk-energy-predictor, hourly cycle)
        │                     │
        ▼                     ▼
 sources.js ── Readings { …, position?, forecast?, stw?, navState?, course? }
        │
        ▼
 engine.js (per tick, both modes)
   ├─ sun.js        sunset/sunrise for today at position        (plan 10)
   ├─ forecast.js   day budget, forecast bias, best hours       (plan 10)
   │                  live budget = solar − house + socBias + forecastBias
   ├─ speed.js      learned v = c · Pᵐ from steady motoring      (plan 11)
   └─ range.js      speed at budget, range until sunset, ETA    (plan 11)
        │
        ▼ Snapshot { …existing, sunset?, dayBudgetW?, forecastBiasW, bestHours?,
        │            speedAtBudget?, rangeUntilSunset?, waypoint? }
        ├─ advisory.js → new plugin.solarsailing.* paths
        └─ resources.js → status (+ trimmed forecast curve for the chart)
```

The forecast and range values change slowly. They are computed on every tick
because the work is tiny (24 forecast entries, one power law), which keeps
the tick a single code path. The advisory output already publishes only on
change or every 5 s, so the delta rate does not grow.

## Sunset (`lib/sun.js`, shared)

`sunTimes(lat, lon, dayStartMs)` → `{ sunrise?, sunset?, alwaysUp, alwaysDown }`
for the local day that contains `dayStartMs`, using the NOAA solar position
equations with the standard −0.833° horizon. "Local day" uses the same ship
time as `energy.js` (`environment.time.timezoneOffset`, else UTC), so "today"
means the same thing everywhere in the plugin.

Order of sources for "time left in the solar day":

1. `navigation.position` fresh (position may be older than `staleSeconds`;
   a separate `positionMaxAgeMinutes`, default 60, because a slow boat moves
   little and the sunset moves even less) → NOAA sunset.
2. No position, forecast present → end of the last forecast hour today with
   `idealSolarYieldWh` above a small floor (5 Wh). Coarse (hour steps), but
   enough for a day budget.
3. Neither → sunset unknown. Day budget and range-until-sunset are `null`;
   speed at budget still works.

Polar day: `alwaysUp` → horizon is the end of the forecast (or 24 h); polar
night or after sunset → `null` and the webapp says "after sunset".

## Sunset target SoC (Tobi, 2026-11-15)
When a target is set, the day budget aims at a state of charge at sunset
instead of "end the day where you started", so a full bank in the morning
can be spent on the way and a low one is refilled. **Off by default**
(Tobi, 2026-11-15): out of the box the day budget is SoC-neutral, as
SPEC 9.2 first described it.

```
bankWh     = (SoC_now − target_eff) · capacityWh          (negative = charge)
dayBudget  = clamp((solarWh − houseWh + bankWh) · 3600 / secondsLeft, 0, max)
target_eff = max(sunsetTargetSoc, minSoc + nightHouseWh / capacityWh)
```

- **Target**: config `sunsetTargetSocPercent`, default 0 = off. A typical
  value is the `socHigh` default of 90 %, so the bank goes into the night
  nearly full.
- **Capacity**: config `batteryCapacityWh`, else the bank's
  `capacity.nominal` (J, Signal K schema) if published, else unknown. On
  this boat nothing publishes it; the predictor's config says 302 Ah × 48 V,
  so set ≈ 14 500 Wh. The plugin does not read another plugin's config file.
- **Night reserve and the floor**: `minSoc` (config `minSocPercent`,
  default 20 %, the same value as the predictor's `minSafeSoC`) plus the
  forecast house energy from sunset to the next sunrise (from
  `forecast.hourly`; without forecast coverage of the night, the floor
  alone). The effective target never drops below what gets the bank
  through the night above the floor, even when the configured target is
  lower.
- **Fallback, unchanged behaviour**: with the target off, capacity
  unknown or SoC unknown, the day budget is the SoC-neutral formula plus
  the static `socBias`, as first planned. `dayBudgetBasis` says which
  (`target` / `neutral`).
- **Interaction with the SoC bias**: with a target, the static `socBias`
  is **not** added to the day budget: the bank term already says "hold back
  when low, spend when full", and adding both would count the battery twice.
  The **live budget is unchanged** (`solar − house + socBias +
  forecastBias`); `socLow`/`socHigh` keep shaping it and the match state.
  The webapp shows both, so a day budget above the live budget in the
  morning reads as "the bank may help today".
- **No round-trip loss term** for now: LiFePO4 is around 95 % and the
  forecast error is larger. Revisit if the sunset SoC lands consistently
  below target.

## New readings (`lib/types.js`, `lib/sources.js`)

```js
/** @typedef {{ lat: number, lon: number, time?: number, stale: boolean }} PositionReading */
/** @typedef {{ t: number, solarWh: number, houseWh: number }} ForecastHour */
/** @typedef {{ time?: number, stale: boolean, hours: ForecastHour[],
 *    status?: 'surplus'|'rising'|'stable'|'deficit'|'critical',
 *    timeToFull?: number, surplusWh?: number,
 *    surplusFrom?: number, surplusTo?: number }} ForecastReading */
/** @typedef {{ mps: number, time?: number, stale: boolean }} SpeedReading */
/** @typedef {{ nextM?: number, routeM?: number, time?: number, stale: boolean }} CourseReading */
```

`Readings` gains optional `position`, `forecast`, `stw`, `navState` and
`course`. Each is read only when its path exists, so an old tree yields the
same `Readings` as today plus `undefined` fields.

## New published paths (SPEC 5.1 additions)

All under `plugin.solarsailing.`. Times are ISO 8601 strings (Signal K has no
timestamp unit; meta description says "ISO 8601 time").

| Path | Units | Plan | Meaning |
|------|-------|------|---------|
| `forecastBias` | W | 10 | Forecast adjustment added to the live budget (0 without forecast) |
| `dayBudget` | W | 10 | Steady motor power that uses the forecast energy until sunset and lands on the sunset target SoC |
| `dayBudgetBasis` | — | 10 | `target` (sunset target SoC) / `neutral` (SoC-neutral fallback) |
| `sunsetTargetSoc` | ratio | 10 | Effective sunset target (configured target, raised for the night reserve) |
| `solarRemaining` | J | 10 | Forecast solar energy from now until sunset |
| `houseRemaining` | J | 10 | Forecast house energy from now until sunset |
| `sunset` | — | 10 | Sunset time today (ISO) |
| `bestHoursStart` / `bestHoursEnd` | — | 10 | Best window to motor today (ISO) |
| `speedAtBudget` | m/s | 11 | Expected speed through water at the range basis budget |
| `rangeUntilSunset` | m | 11 | Distance through water at that speed until sunset |
| `rangeBasis` | — | 11 | `dayBudget` / `budget` (which budget the range uses) |
| `waypointEta` | — | 11 | ETA at the next waypoint at `speedAtBudget` (ISO) |
| `waypointRequiredPower` | W | 11 | Motor power needed to reach the next waypoint by sunset |
| `destinationEta` | — | 11 | ETA at the final destination (end of the active route, or the single destination) |
| `destinationRequiredPower` | W | 11 | Motor power needed to reach the final destination by sunset |

`socBias` keeps its meaning (the SoC curve of SPEC 2.2 only), so the webapp
and history can show how much of the budget came from the forecast.

`displayUnits`: `power`/`W`, `energy`/`Wh`, speed `kn`, distance `nm`.
The exact server category names for speed and distance are checked against
the server's unit definitions in plan 10, the same way `Wh` was chosen over
`kWh` (ARCHITECTURE 2.6).

## New config (SPEC 8 additions)

| Setting | Default | Plan |
|---------|---------|------|
| Use solar forecast | on (no effect without a forecast) | 10 |
| Forecast path | `electrical.energy.prediction` | 10 |
| Forecast max age | 180 min (the predictor's default cycle is 60 min) | 10 |
| Surplus assist cap | 300 W | 10 |
| Deficit reserve / critical reserve | 100 W / 200 W | 10 |
| Best-hours window | 3 h | 10 |
| Sunset target SoC | 0 = off (SoC-neutral) | 10 |
| Battery capacity | 0 Wh = from `capacity.nominal`, else unknown | 10 |
| Minimum SoC (night floor) | 20 % | 10 |
| Position max age | 60 min | 10 |
| Speed through water path | `navigation.speedThroughWater` | 11 |
| STW correction factor (fouled log) | 1.0 | 11 |
| Fallback speed model (`c`, `m`) | none / ⅓ (speed hidden until learned) | 11 |
| Reset learned speed model | off | 11 |

All have defaults in the schema (registry: schema criterion).

## Registry and packaging
- `signalk.recommends` gains `@meri-imperiumi/signalk-energy-predictor`
  (SPEC 9.3 already says so), and the README names it as optional.
- No new runtime dependency; `npm audit --omit=dev` stays clean.
- Screenshots are retaken in plan 12; `signalk.screenshots` keeps two files.
- `CHANGELOG.md` `Unreleased` entry per plan.

## Open questions for Tobi
1. **Predictor engine config.** Checked on the server (2026-11-15): the
   predictor has engine `main` with `alternatorWatts: 0`. It only gates
   motoring out of its house load if `propulsion.main` gets live revolutions;
   the venus plugin publishes the Curtis as `propulsion.99`, and
   `propulsion.main` currently holds only the gear ratio from `baseDeltas`.
   To confirm the next time the motor runs (details in plan 10).
2. **Day budget and the bank.** Answered (Tobi, 2026-11-15): make it
   target-SoC aware from the start, configurable and off by default. See
   "Sunset target SoC" above.
3. **Speed model input.** Answered (Tobi, 2026-11-15): learn speed from
   motor power. The propeller learner's behaviour does not change; plan 11
   only moves its shared fitting code into `lib/powerlaw.js`, guarded by the
   unchanged propeller tests, and the speed model keeps its own samples and
   `speed.json`.
4. **Speed through water sensor.** Answered (Tobi, 2026-11-15): Airmar
   DST810 on NMEA 2000, unplugged over the winter. Plan 11 is built and
   tested on synthetic data; the range values stay hidden (unlearned model)
   until the log is back, and a spring capture becomes the real fixture.
   The log may be fouled and read low: plan 11 adds an STW correction
   factor and suggests one from SOG/STW over several headings.
