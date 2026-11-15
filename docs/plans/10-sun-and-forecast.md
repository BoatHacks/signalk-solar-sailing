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
| `forecast.hourly` | array of `{ time (ISO, hour start), idealSolarYieldWh, houseLoadWh, idealNetWh, idealSoC, … }`, 24 entries by default | day budget, best hours, chart curve |
| `status` | `surplus` / `rising` / `stable` / `deficit` / `critical` / `null` | forecast bias |
| `timeToFull` | ISO or `null` | surplus bias guard |
| `surplus`, `surplus.from`, `surplus.to` | Wh, ISO, ISO (0 / `null` when none) | surplus bias |

Notes from the source: values are Wh, not J; `houseLoadWh` is the learned
DC + AC load and excludes motoring only if the motor is configured as an
engine in the predictor (open question 1 in plan 9); the prediction cycle
runs every 60 min by default, so the forecast age, not `staleSeconds`,
decides freshness. The parser accepts the value as an array or a JSON string
and skips malformed entries, because the shape is another plugin's and not
in the Signal K schema.

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
- `dayBudget({ solarWh, houseWh }, now, sunset, socBiasW, maxMotorPowerW)` →
  W: `(solarWh − houseWh) · 3600 / secondsLeft + socBiasW`, clamped to
  `[0, max]`; `undefined` when less than 15 min remain (division blows up and
  the advice is useless then).
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
  `solarRemainingJ?`, `houseRemainingJ?`, `bestHours?`, and
  `forecastStatus?` for the webapp. The match state stays against the live
  budget: the day budget is advice, not the alarm threshold.

### Sources (`lib/sources.js`)
- `readPosition(tree, config, now)` from `navigation.position`
  (`{ latitude, longitude }`), stale after `positionMaxAgeMinutes`.
- `readForecast(tree, config, now)` walks the configured forecast path only
  when `useForecast` is on, then calls `parseForecast`.

### Outputs
- `advisory.js`: `PATH_META` entries for `forecastBias`, `dayBudget`,
  `solarRemaining`, `houseRemaining`, `sunset`, `bestHoursStart`,
  `bestHoursEnd`; `null` when unknown.
- `resources.js`: `status` gains `forecast: { status, age, hours: [{ t, solarW, houseW }] }`
  (average W per hour, today until sunset plus one, at most 24 entries), so
  the chart can draw the curve without subscribing to the predictor's large
  JSON value over the WebSocket.

### Config (`lib/config.js`)
`useForecast`, `forecastPath` (validated like the other path overrides),
`forecastMaxAgeMinutes`, `surplusAssistCapW`, `deficitReserveW`,
`criticalReserveW`, `bestHoursWindowH`, `positionMaxAgeMinutes`, with
defaults from plan 9.

## Test Strategy
Fixture: `test/fixtures/energy-prediction-sample.json`, an
`electrical.energy.prediction` subtree in the 0.14.1 shape (hand-built from
the package source; replaced by a capture from the boat once the predictor
runs there).

- `sun.js`: sunrise/sunset within 2 min of published tables for three cases
  (Kiel in November, equator, a southern-hemisphere date), polar day and
  polar night flags at 78° N, day boundary with timezone offsets `200`,
  `-930`, missing.
- `parseForecast`: array and JSON-string input; malformed entries skipped;
  stale by age; stale when all hours are past; non-object node → `undefined`.
- `remainingUntil`: prorating at both ends; sunset before the first entry;
  sunset past the last entry (uses what is covered, never extrapolates).
- `dayBudget`: hand-computed cases; clamp at 0 and at max motor power;
  `undefined` under 15 min left and after sunset.
- `forecastBias`: surplus with and without `timeToFull`, with SoC below
  `socLow` (no assist), cap applied, `surplus.to` in the past; deficit;
  critical; stale → 0.
- `bestHours`: single peak, flat curve (earliest window wins), fewer hours
  left than the window, after sunset → `undefined`.
- Engine: **without a forecast the snapshot equals today's** for the Curtis
  fixture replay (regression guard); with the sample forecast the budget
  differs by exactly `forecastBiasW`; idle mode still fills the forecast
  fields.
- Sources: no position and no forecast in the tree → readings unchanged
  apart from `undefined` fields; `useForecast` off → forecast ignored.
- Plugin: `start()` with default config, empty tree, no network (existing
  registry test) still passes.

## Implementation Steps
- [ ] `lib/sun.js` + tests
- [ ] `lib/forecast.js` + fixture + tests
- [ ] Readings, sources, config fields
- [ ] Engine: forecast bias, sunset, day budget, best hours
- [ ] Advisory paths and metadata; check the server's `displayUnits`
      categories for the new units
- [ ] Resources: forecast curve in `status`
- [ ] SPEC 2.2, 4, 5.1, 8, 9.2 and ARCHITECTURE 2.2, 2.3, 3, 9 updated;
      `recommends` and README; CHANGELOG

## Files to Create/Modify
`lib/sun.js`, `lib/forecast.js`, `lib/sources.js`, `lib/engine.js`,
`lib/types.js`, `lib/config.js`, `lib/outputs/advisory.js`,
`lib/resources.js`, `test/sun.test.js`, `test/forecast.test.js`,
`test/fixtures/energy-prediction-sample.json`, `test/engine.test.js`,
`test/sources.test.js`, `package.json`, `README.md`, `CHANGELOG.md`,
`docs/SPEC.md`, `docs/ARCHITECTURE.md`
