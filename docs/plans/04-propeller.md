# Implementation Plan: Propeller model

## Overview
Learn `k` and `n` in `P = k · rpmⁿ` from steady motoring and give the engine
a target motor RPM (and shaft RPM when a gear ratio is known).

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 2.4, 7, 8
- ARCHITECTURE 2.4

## Approach
`PropellerModel` with `observe(rpm, watts, inDrive, now)`, `fit()`,
`targetRpm(budgetW)`, `toJSON()` / `fromJSON()`. Steady-state detection over a
10 s window (±5 % RPM and power, RPM > 200). Ring buffer of 300 pairs
bucketed by 25 rpm; Theil–Sen fit on `ln P` vs `ln rpm`. Exponent guard: fit
`n` only with ≥ 4 buckets and max/min RPM ≥ 1.5, else `n` = fallback (3) and
fit `k` alone; clamp `n` to 1–3.5. Ready after 30 samples.

## Test Strategy
- synthetic data with known `k`, `n` (1.35 and 3) is recovered within 5 %
- outliers (10 % of samples ×2 power) barely move the fit
- narrow RPM band → `n` stays 3, `k` still fitted
- transients (ramp-up in the log) are rejected as non-steady
- `targetRpm` inverts the model; `undefined` until ready
- round trip through `toJSON` / `fromJSON`
- the 2026-10-25 log produces either no fit (too few steady samples) or one
  with `n` in 1–3.5, never NaN

## Implementation Steps
- [x] `lib/propeller.js`
- [x] Persistence helpers: read/write `<dataDir>/propeller.json` (called from
      `index.js` in plan 6: on start, every 5 min, on stop)
- [x] Config action "reset learned propeller"
- [x] Engine step 6 uses the model; shaft RPM = target ÷ gear ratio

## Files to Create/Modify
`lib/propeller.js`, `lib/engine.js`, `test/propeller.test.js`
