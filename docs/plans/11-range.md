# Implementation Plan: Range and speed estimate

## Overview
"At this budget you make X kn and cover Y nm before sunset; the next waypoint
is reached at HH:MM, or needs Z W." The plugin learns how fast the boat goes
for a given motor power, then applies that to the day budget (or the live
budget without a forecast) and to the time left until sunset from plan 10.
Shared design, paths and config: [09](09-forecast-and-range.md).

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 2.4 (learning approach to copy), 2.6, 4, 5.1, 7, 9.2 (range/speed)
- ARCHITECTURE 2.3, 2.4, 9 (range estimate)

## Approach

### Speed model: learn `v = c · Pᵐ` (`lib/speed.js`)
Speed through water against **motor power**, not against RPM:

- the budget is in watts, so one model maps budget straight to speed with no
  chained error from the propeller model;
- it works on boats without RPM (no venus PR #210);
- a displacement hull at low speed follows roughly `P ∝ v³`, so `m` starts
  at ⅓, the same "start from theory, fit once the data spans enough range"
  pattern as the propeller exponent (SPEC 2.4).

The learning machinery is the propeller's, generalised:

- **Refactor first**: move `median`, `theilSen` and the bucketed ring buffer
  out of `lib/propeller.js` into `lib/powerlaw.js` (`PowerLawLearner` with
  bucket function, floors, exponent guard and clamp as options). The
  propeller tests must pass unchanged before the speed model is added.
- **Sample** while in drive, in active mode, when STW is fresh and above
  0.3 m/s, power above the idle threshold, and power and STW each within
  ±5 % of their 10 s mean (STW also within ±0.1 m/s, since small speeds make
  5 % meaningless). At most one sample every 5 s.
- **Not while sailing**: skip samples when `navigation.state` is `sailing`;
  when the state is absent, accept (a motorsailing sample is an outlier the
  Theil–Sen fit tolerates; a fouled-up model can be reset).
- **Buckets** by power, logarithmic (10 % wide), at most 30 samples each, 300
  total.
- **Fit** `ln v = ln c + m · ln P`. `m` only with ≥ 4 buckets and a max/min
  power ratio ≥ 2, else `m` stays at the fallback and only `c` is fitted.
  Clamp `m` to 0.15–0.6. Ready after 30 samples.
- **Persist** `{ c, m, samples, updatedAt }` to `<dataDir>/speed.json` with
  the same timing as `propeller.json`; config button "reset learned speed
  model".
- **SOG is not used for learning.** Current would teach the model a false
  speed. Without an STW sensor the speed model stays unlearned unless a
  fallback `c` is configured (open question 4 in plan 9).

### Range maths (`lib/range.js`, pure)
- `rangeBasis`: `dayBudget` when known, else the live (smoothed) `budget`.
  Published as `rangeBasis` so the webapp can say which.
- `speedAtBudget = c · basisᵐ`, `undefined` until the model is ready or when
  the basis is unknown or 0.
- `rangeUntilSunset = speedAtBudget · secondsUntilSunset`; `undefined` after
  sunset or when sunset is unknown. Through water: the label says so.
- **Waypoint** (only when a course is active): distance to the next point
  from the Course API value `navigation.course.calcValues.distance`
  (path to be confirmed on the server in step 1; ignore when stale or
  absent).
  - `waypointEta = now + distance / speedAtBudget`.
  - `requiredSpeed = distance / secondsUntilSunset`;
    `requiredPower = (requiredSpeed / c)^(1/m)`, shown against the day
    budget ("needs 620 W, 140 W over the day budget"). `undefined` after
    sunset or when the inverse leaves the learned power range by more than
    50 % (the power law is not trusted far outside its samples).

### Engine and outputs
- Engine owns a `SpeedModel` like the `PropellerModel`: observes in active
  mode only (learning pauses in idle, SPEC 2.6), computes the range fields
  every tick in both modes.
- Snapshot gains `speedAtBudget?`, `rangeUntilSunsetM?`, `rangeBasis?`,
  `waypointEta?`, `requiredPowerW?`, and `stw?` for the webapp.
- `index.js` loads and saves `speed.json` next to `propeller.json`.
- `advisory.js`: `PATH_META` for `speedAtBudget` (m/s), `rangeUntilSunset`
  (m), `rangeBasis`, `waypointEta`, `requiredPower` (W).
- `resources.js`: `status` gains the model state (`ready`, sample count,
  `c`, `m`, power range covered) for the webapp's "learning…" hint.

### Sources
`readSpeed` for STW (configurable path), `readNavState` for
`navigation.state`, `readCourse` for the distance. All optional.

## Test Strategy
- `powerlaw.js` refactor: existing `propeller.test.js` unchanged and green.
- `speed.js`: synthetic data with known `c`, `m` (⅓ and 0.45) recovered
  within 5 %; narrow power band keeps `m` at fallback and still fits `c`;
  outliers (10 % of samples at +20 % speed, as if sailing) barely move it;
  `sailing` state rejected; non-steady STW rejected; `toJSON`/`fromJSON`
  round trip; never NaN.
- `range.js`: basis choice; `undefined` cases (not ready, no sunset, after
  sunset, budget 0); `requiredPower` inverse round trip; the out-of-range
  guard.
- Engine: learning only in active mode; range filled in idle once learned;
  without STW, forecast or course the snapshot equals plan 10's output.
- A boat log with STW would make a real fixture; the 2026-10-25 Curtis log
  has none, so this waits on open question 4. Synthetic tests until then.

## Implementation Steps
- [ ] Confirm the Course API distance path and the STW source on the boat
- [ ] `lib/powerlaw.js` refactor, propeller tests unchanged
- [ ] `lib/speed.js` + tests
- [ ] `lib/range.js` + tests
- [ ] Sources, config, engine, persistence in `index.js`
- [ ] Advisory paths and metadata, resources
- [ ] SPEC 2.4 (speed model), 5.1, 7, 8 and ARCHITECTURE 2.3, 2.4, 3, 9
      updated; CHANGELOG

## Files to Create/Modify
`lib/powerlaw.js`, `lib/propeller.js`, `lib/speed.js`, `lib/range.js`,
`lib/sources.js`, `lib/engine.js`, `lib/types.js`, `lib/config.js`,
`lib/outputs/advisory.js`, `lib/resources.js`, `index.js`,
`test/speed.test.js`, `test/range.test.js`, `test/engine.test.js`,
`CHANGELOG.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`
