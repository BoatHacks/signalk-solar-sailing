# Implementation Plan: Sun and solar forecast

## Overview
Read the optional forecast from `@meri-imperiumi/signalk-energy-predictor`,
compute sunset at the boat's position, and derive three things from them: a
**day budget** shown beside the live budget, a **forecast bias** that makes
the live budget forecast-aware, and the **best hours to motor** today. Shared
design, paths and config: [09](09-forecast-and-range.md).

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 2.2, 4, 5.1, 8, 9.2 (solar forecast input), 11
- ARCHITECTURE 2.2, 2.3, 2.6, 2.8, 9

## Input contract (signalk-energy-predictor 0.14.x)
Published under `electrical.energy.prediction.` (checked against the 0.14.1
package source, `plugin/advisory.js` and `plugin/prediction.js`):

| Path | Shape | Used for |
|------|-------|----------|
| `forecast.hourly` | array of `{ hour, time (ISO, start of a 1 h slot), idealSolarYieldWh, houseLoadWh, idealNetWh, idealSoC, … }`, 24 entries by default | day budget, best hours, chart curve |
| `status` | `surplus` / `rising` / `stable` / `deficit` / `critical` / `null` | forecast bias |
| `timeToFull` | ISO or `null` | surplus bias guard |
| `surplus`, `surplus.from`, `surplus.to` | Wh, ISO, ISO (`surplus` 0 and the window paths absent when none) | surplus bias |

Notes from the source: values are Wh, not J; `houseLoadWh` is the learned
DC + AC load and excludes motoring only if the motor is configured as an
engine in the predictor (open question 1 in plan 9); the prediction cycle
runs every 60 min by default, so the forecast age, not `staleSeconds`,
decides freshness. The parser accepts the value as an array or a JSON string
and skips malformed entries, because the shape is another plugin's and not
in the Signal K schema.

### Checked on the boat server (2026-11-15)
Read-only check of the live server running predictor 0.14.1:

- **Slots are not hour-aligned.** `time` is the run time plus *h* hours
  (`14:15:02Z`, `15:15:02Z`, …), so every calculation treats an entry as the
  interval `[time, time + 1 h)` and prorates by overlap, never by clock hour.
- **Paths time out.** The server nulls a path 60 s after its last update
  (`value: null`, `state.timedOut: true`, real data in `state.lastValue`).
  The predictor publishes once an hour, so a plain read of the tree returns
  `null` for about 59 minutes of every hour. `navigation.state` behaves the
  same. The forecast is therefore **not read from the tree on the tick**:
  `index.js` subscribes to `<forecastPath>.*` and `navigation.state` and
  keeps the last value and its timestamp in a small cache that
  `readSources` reads. Freshness comes from our own `forecastMaxAgeMinutes`,
  not the server's timeout. This is the one exception to "read on a tick"
  (SPEC 11). It is safe because nothing is counted: a duplicate delta only
  overwrites the cache with the same value.
- `forecast.hourly` is a real JSON array; `surplus` a plain number; the
  `surplus.from`/`to` paths are absent with no surplus; `timeToFull` `null`.
- The predictor has an engine `main` with `alternatorWatts: 0`, so motoring
  is gated out of its load profile **if** `propulsion.main` gets live
  revolutions while motoring. On the server today `propulsion.main` only
  holds `transmission.gearRatio` (2.67) from `baseDeltas`, and the venus
  plugin publishes the Curtis as `propulsion.99`. To confirm when the motor
  is next used; if `main` has no revolutions, map `99` to `main` (or
  change the predictor's engine id to `99`).
- Battery: 302 Ah at 48 V (≈ 14.5 kWh) in the predictor config;
  `electrical.batteries.main` has no `capacity.nominal`.
- Captured as `test/fixtures/energy-prediction-2026-11-15.json`. `idealNetWh`
  is rounded separately from its parts, so tests must not assume
  `net = solar − house` exactly.

## Approach

### `lib/sun.js`
`sunTimes(lat, lon, dayStartMs)` (NOAA equations, −0.833° horizon) and
`dayStart(now, tzOffsetMin)` reused from `energy.js`'s day key. Pure, no
`Date` parsing of local strings.

### `lib/forecast.js` (pure)
- `parseForecast(node, now, maxAgeMs)` → `ForecastReading | undefined`.
  Converts ISO to ms, Wh stay Wh internally, drops entries that ended before
  `now`, marks the reading stale when the `hourly` timestamp is older than
  `maxAgeMs` or the last entry is in the past.
- `remainingUntil(hours, now, end)` → `{ solarWh, houseWh }`, prorating the
  hour that contains `now` and the hour that contains `end` linearly.
- `nightHouseWh(hours, sunset, nextSunrise)` → Wh of forecast house load
  through the night, or `undefined` when the forecast doesn't cover it.
- `sunsetTarget(config, nightWh, capacityWh)` → effective target SoC
  (plan 9, "Sunset target SoC"), or `undefined` when the target is off or
  capacity unknown.
- `dayBudget({ solarWh, houseWh }, now, sunset, { soc, target, capacityWh,
  socBiasW, maxMotorPowerW })` → `{ watts, basis }`:
  - `basis: 'target'` when target, capacity and SoC are known:
    `(solarWh − houseWh + (soc − target) · capacityWh) · 3600 / secondsLeft`;
  - else `basis: 'neutral'`: `(solarWh − houseWh) · 3600 / secondsLeft + socBiasW`;
  - clamped to `[0, max]`; `undefined` when less than 15 min remain
    (division blows up and the advice is useless then).
- `forecastBias(reading, now, soc, config)` → W:
  - `surplus` with `timeToFull` set, `surplus.to` in the future and SoC above
    `socLow`: `+ min(surplusWh · 3600 / secondsUntil(surplus.to), surplusAssistCapW)`.
    This is energy the controller would curtail anyway, spread from now until
    the end of the surplus window, so motoring now drains the bank only by
    what the afternoon refills.
  - `deficit`: `− deficitReserveW`; `critical`: `− criticalReserveW`.
  - anything else, stale or absent: 0.
- `bestHours(hours, now, sunset, windowH)` → `{ start, end } | undefined`:
  contiguous window of `windowH` hours (shorter if less day is left) with the
  largest `Σ(solarWh − houseWh)`, from the current hour until sunset.

### Engine changes (`lib/engine.js`)
- Step 3 becomes `socBiasW` (unchanged) plus `forecastBiasW`; the live budget
  is `solar − house + socBias + forecastBias`, same clamp and smoother. With
  no forecast `forecastBiasW` is 0 and the budget is bit-for-bit today's.
- New step after the budget: sunset (position, else forecast, else none),
  `solarRemaining`, `houseRemaining`, `dayBudget`, `bestHours`. Computed in
  idle too, so the skipper sees the day budget before starting the motor.
- Snapshot gains `sunset?`, `forecastBiasW`, `dayBudgetW?`,
  `solarRemainingJ?`, `houseRemainingJ?`, `bestHours?`, `dayBudgetBasis?`,
  `sunsetTargetSoc?`, and
  `forecastStatus?` for the webapp. The match state stays against the live
  budget: the day budget is advice, not the alarm threshold.

### Sources (`lib/sources.js`)
- `readBattery` also reads `capacity.nominal` (J → Wh) when present, as
  `BatteryReading.capacityWh`.
- `readPosition(tree, config, now)` from `navigation.position`
  (`{ latitude, longitude }`), stale after `positionMaxAgeMinutes`.
- `readForecast(cache, config, now)` reads the subscription cache (see
  "Checked on the boat server") only when `useForecast` is on, then calls
  `parseForecast`. `index.js` owns the subscription and drops it on `stop()`.

### Outputs
- `advisory.js`: `PATH_META` entries for `forecastBias`, `dayBudget`, `dayBudgetBasis`, `sunsetTargetSoc`,
  `solarRemaining`, `houseRemaining`, `sunset`, `bestHoursStart`,
  `bestHoursEnd`; `null` when unknown.
- `resources.js`: `status` gains `forecast: { status, age, hours: [{ t, solarW, houseW }] }`
  (average W per hour, today until sunset plus one, at most 24 entries), so
  the chart can draw the curve without subscribing to the predictor's large
  JSON value over the WebSocket.

### Config (`lib/config.js`)
`useForecast`, `forecastPath` (validated like the other path overrides),
`forecastMaxAgeMinutes`, `surplusAssistCapW`, `deficitReserveW`,
`criticalReserveW`, `bestHoursWindowH`, `positionMaxAgeMinutes`,
`sunsetTargetSocPercent`, `batteryCapacityWh`, `minSocPercent`, with
defaults from plan 9.

## Test Strategy
Fixture: `test/fixtures/energy-prediction-2026-11-15.json`, captured from
the boat server (14:15Z run, no surplus, status `stable`). A copy with a
surplus window added by hand covers the surplus bias.

- `sun.js`: sunrise/sunset within 2 min of published tables for three cases
  (Kiel in November, equator, a southern-hemisphere date), polar day and
  polar night flags at 78° N, day boundary with timezone offsets `200`,
  `-930`, missing.
- Engine: target off, capacity or SoC missing → `basis: 'neutral'` and the
  same day budget as without this feature.
- `parseForecast`: array and JSON-string input; slots offset from the clock
  hour (the live `:15:02` start); malformed entries skipped;
  stale by age; stale when all hours are past; non-object node → `undefined`.
- `remainingUntil`: prorating at both ends; sunset before the first entry;
  sunset past the last entry (uses what is covered, never extrapolates).
- `dayBudget`: hand-computed cases for both bases; clamp at 0 and at max
  motor power; `undefined` under 15 min left and after sunset; SoC below
  target gives a lower budget than neutral, above target a higher one;
  `socBias` is not added on the `target` basis.
- `sunsetTarget`: configured target used as is; raised by the night
  reserve when `minSoc + night / capacity` is higher (fixture night:
  ≈ 380 Wh on 14 500 Wh → floor 22.6 %); target 0 → `undefined`; no
  capacity → `undefined`; capacity from `capacity.nominal` in J when config
  is 0.
- `forecastBias`: surplus with and without `timeToFull`, with SoC below
  `socLow` (no assist), cap applied, `surplus.to` in the past; deficit;
  critical; stale → 0.
- `bestHours`: single peak, flat curve (earliest window wins), fewer hours
  left than the window, after sunset → `undefined`.
- Engine: **without a forecast the snapshot equals today's** for the Curtis
  fixture replay (regression guard); with the sample forecast the budget
  differs by exactly `forecastBiasW`; idle mode still fills the forecast
  fields.
- Cache: a timed-out `null` delta does not overwrite the cached forecast;
  the cache ages out by `forecastMaxAgeMinutes`.
- Sources: no position and no forecast in the tree → readings unchanged
  apart from `undefined` fields; `useForecast` off → forecast ignored.
- Plugin: `start()` with default config, empty tree, no network (existing
  registry test) still passes.

## Implementation Steps
- [ ] `lib/sun.js` + tests
- [ ] `lib/forecast.js` + fixture + tests
- [ ] Readings, sources, config fields
- [ ] Engine: forecast bias, sunset, day budget (target and neutral),
      sunset target SoC, best hours
- [ ] Advisory paths and metadata; check the server's `displayUnits`
      categories for the new units
- [ ] Resources: forecast curve in `status`
- [ ] SPEC 2.2, 4, 5.1, 8, 9.2 (day budget now aims at the sunset target) and ARCHITECTURE 2.2, 2.3, 3, 9 updated;
      `recommends` and README; CHANGELOG

## Files to Create/Modify
`lib/sun.js`, `lib/forecast.js`, `lib/sources.js`, `lib/engine.js`,
`lib/types.js`, `lib/config.js`, `lib/outputs/advisory.js`,
`lib/resources.js`, `index.js`, `test/sun.test.js`, `test/forecast.test.js`,
`test/fixtures/energy-prediction-2026-11-15.json`, `test/engine.test.js`,
`test/sources.test.js`, `package.json`, `README.md`, `CHANGELOG.md`,
`docs/SPEC.md`, `docs/ARCHITECTURE.md`
