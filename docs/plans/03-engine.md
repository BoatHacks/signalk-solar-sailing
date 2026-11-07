# Implementation Plan: Engine

## Overview
`Engine.update(readings, now)` returns a `Snapshot`: solar, house load, SoC
bias, smoothed budget, balance, match state and the over-budget alarm flag.

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 1.3, 2.1–2.3, 2.5, 8 (defaults)
- ARCHITECTURE 2.3, 3

## Approach
Stateful class, no I/O. Reuses the draft `Smoother`, `batteryBias`, `clamp`,
`verdict` from `matcher.js`; drops `recommend`, `rampLimit`, `shouldSend`,
`MODES` (kept aside for the post-MVP put output). Target RPM is a hook filled
by plan 4.

## Test Strategy
- house load source order: `dcSystem − motor` when both fresh (or `dcSystem`
  with "includes motor" off), else `solar − battery − motor`, else config;
  clamped ≥ 0; `houseSource` set accordingly
- stale DC system power falls through to the balance without a jump larger
  than the smoothing allows
- SoC bias at ≤ low, ≥ high, midpoint, unknown
- budget clamped to `[0, maxMotorPowerW]`; no max → no upper clamp
- smoothing: a 1 s cloud dip barely moves the budget; a 2 min one does
- match state with tolerance `max(50 W, 10 %)`; `unknown` when solar or
  motor missing, or not in drive
- alarm only after `over` for `overBudgetDelaySeconds` while in drive;
  resets on matched/under or leaving drive
- `mode` is `active` while in drive and turns `idle` after `idleAfterSeconds`
  out of drive or on stale motor data; in idle, match state is `unknown`,
  smoothing, propeller observation and the alarm timer don't advance
- a replay of the laserbrain log runs without throwing and never reports
  `matched` while solar is unknown

## Implementation Steps
- [x] Trim `matcher.js` to the reused helpers
- [x] `lib/engine.js` with the seven steps of ARCHITECTURE 2.3
- [x] Tests above, including a log replay helper in `test/helpers/`

## Files to Create/Modify
`lib/matcher.js`, `lib/engine.js`, `test/engine.test.js`,
`test/matcher.test.js`, `test/helpers/replay.js`
