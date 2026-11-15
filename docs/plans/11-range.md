# Implementation Plan: Range and speed estimate

## Overview
"At this budget you make X kn and cover Y nm before sunset; the next waypoint
is reached at HH:MM and the destination at HH:MM, or needs Z W." The plugin learns how fast the boat goes
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

### Fouled log: STW reading low (Tobi, 2026-11-15)
The DST810's paddlewheel may be fouled and read slower than the boat moves.
A proportional under-read only scales `c` (the exponent `m` is unaffected),
so the range comes out pessimistic, which is the safe direction, but it
should still be correctable:

- **Config `stwFactor`** (default 1.0): multiplies STW before learning and
  display. Changing it rescales the stored `c` instead of discarding the
  samples (samples are stored raw, the factor is applied at fit time).
- **Suggested factor, never applied automatically**: while motoring with
  fresh STW, SOG and COG, collect `SOG / STW` ratios bucketed by heading
  (8 sectors). Current cancels out over opposite headings, so once at least
  4 sectors have 10 samples each, the median of the per-sector medians is
  published in `status` as `stwFactorSuggested` with its spread. The
  webapp shows it in the learning hint; the skipper decides whether to set
  it (cleaning the wheel is the real fix).
- A sudden drop of the ratio's level (fresh weed growth) only moves the
  suggestion; the learned model is not reset automatically.

### Range maths (`lib/range.js`, pure)
- `rangeBasis`: `dayBudget` when known, else the live (smoothed) `budget`.
  Published as `rangeBasis` so the webapp can say which.
- `speedAtBudget = c · basisᵐ`, `undefined` until the model is ready or when
  the basis is unknown or 0.
- `rangeUntilSunset = speedAtBudget · secondsUntilSunset`; `undefined` after
  sunset or when sunset is unknown. Through water: the label says so.
- **Next waypoint and final destination** (Tobi, 2026-11-15): both are
  shown whenever a course is active. Distances come from the bundled
  `@signalk/course-provider` (checked on the boat server, 2.37.0 with
  course-provider 1.5.1); the plugin does no route geometry of its own:

  | Target | Distance (m) | When |
  |--------|--------------|------|
  | Next waypoint | `navigation.course.calcValues.distance` | any active course |
  | Final destination | `navigation.course.calcValues.route.distance` | active route; course-provider sums the remaining legs from `pointIndex` (respects `reverse` and the great-circle/rhumb setting) |
  | Final destination, single-point course | same as next waypoint | `route.distance` is `null` without a route |

  For each target, with `secondsLeft` until sunset:
  - `eta = now + distance / speedAtBudget`;
  - `requiredSpeed = distance / secondsLeft`,
    `requiredPower = (requiredSpeed / c)^(1/m)`, shown against the day
    budget ("needs 620 W, 140 W over the day budget");
  - `undefined` when the distance is stale or `null`, the model is not
    ready, or (for `requiredPower`) after sunset or when the inverse leaves
    the learned power range by more than 50 % (the power law is not
    trusted far outside its samples). An ETA after sunset is still shown,
    flagged `afterSunset`.
  - course-provider's own `timeToGo`/`estimatedTimeOfArrival` are not
    used: they come from the current VMC and are `null` whenever the boat
    is not closing on the mark (stopped, or on the wrong tack), which is
    exactly when the skipper asks "can I make it on the sun?".
  - Caveats in the label: distances are along the route over ground,
    speed is through the water, so current is not in the ETA; the arrival
    circle is not subtracted (metres, irrelevant at these distances).
  - Without course-provider (non-default servers) the course values are
    absent and the waypoint lines are hidden; reading `app.getCourse()` and
    the route resource to sum legs ourselves is possible but not planned.

### Engine and outputs
- Engine owns a `SpeedModel` like the `PropellerModel`: observes in active
  mode only (learning pauses in idle, SPEC 2.6), computes the range fields
  every tick in both modes.
- Snapshot gains `speedAtBudget?`, `rangeUntilSunsetM?`, `rangeBasis?`,
  `waypoint?` and `destination?` (each `{ distanceM, eta, afterSunset,
  requiredPowerW? }`), and `stw?` for the webapp.
- `index.js` loads and saves `speed.json` next to `propeller.json`.
- `advisory.js`: `PATH_META` for `speedAtBudget` (m/s), `rangeUntilSunset`
  (m), `rangeBasis`, `waypointEta`, `waypointRequiredPower` (W),
  `destinationEta`, `destinationRequiredPower` (W). Distances are not
  republished; they stay course-provider's paths.
- `resources.js`: `status` gains the model state (`ready`, sample count,
  `c`, `m`, power range covered) for the webapp's "learning…" hint.

### Sources
`readSpeed` for STW (configurable path), `readNavState` for
`navigation.state`, `readCourse` for `calcValues.distance` and
`calcValues.route.distance` (read on the tick: course-provider publishes
them continuously, so the server's 60 s timeout does not bite). All
optional.

## Test Strategy
- `powerlaw.js` refactor: existing `propeller.test.js` unchanged and green.
- `speed.js`: synthetic data with known `c`, `m` (⅓ and 0.45) recovered
  within 5 %; narrow power band keeps `m` at fallback and still fits `c`;
  outliers (10 % of samples at +20 % speed, as if sailing) barely move it;
  `sailing` state rejected; non-steady STW rejected; `toJSON`/`fromJSON`
  round trip; never NaN.
- `range.js`: basis choice; `undefined` cases (not ready, no sunset, after
  sunset, budget 0); `requiredPower` inverse round trip; the out-of-range
  guard; destination = route distance with a route, = next-point distance
  without one; ETA after sunset flagged; no course → both `undefined`;
  a `null` course-provider ETA (VMC ≤ 0) does not affect ours.
- Engine: learning only in active mode; range filled in idle once learned;
  without STW, forecast or course the snapshot equals plan 10's output.
- The DST810 is unplugged over the winter and the 2026-10-25 Curtis log has
  no STW, so tests are synthetic until spring. Then a capture from the first
  motoring days (STW, motor power, `navigation.state`) becomes
  `test/fixtures/stw-<date>.json`, with a test that the fit lands in the
  clamp range and the range values appear.

## Implementation Steps
- [x] Confirm the course paths on the boat (2026-11-15: `calcValues.distance`
      and `calcValues.route.distance` from course-provider 1.5.1)
- [ ] Confirm the STW path when the DST810 is back
- [x] `lib/powerlaw.js` refactor, propeller tests unchanged
- [x] `lib/speed.js` + tests (incl. `stwFactor` rescaling and the
      SOG/STW heading-sector suggestion)
- [x] `lib/range.js` + tests
- [x] Sources, config, engine, persistence in `index.js`
- [x] Advisory paths and metadata, resources
- [x] SPEC 2.4 (speed model), 5.1, 7, 8 and ARCHITECTURE 2.3, 2.4, 3, 9
      updated; CHANGELOG
- [ ] Before shipping: set a test route on the plotter and check
      `waypointEta`, `destinationEta` and the required powers against
      course-provider's distances (no route on the server yet, 2026-11-15)
- [ ] Spring, DST810 back: capture an STW fixture, check the learned
      `c`, `m` against it, tune the steady-state gate if needed, and
      compare the suggested `stwFactor` before and after cleaning the wheel

## Files to Create/Modify
`lib/powerlaw.js`, `lib/propeller.js`, `lib/speed.js`, `lib/range.js`,
`lib/sources.js`, `lib/engine.js`, `lib/types.js`, `lib/config.js`,
`lib/outputs/advisory.js`, `lib/resources.js`, `index.js`,
`test/speed.test.js`, `test/range.test.js`, `test/engine.test.js`,
`CHANGELOG.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`
