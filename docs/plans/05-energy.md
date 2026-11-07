# Implementation Plan: Energy today

## Overview
Solar and motor energy since local midnight, carried over restarts via the
Signal K History API (signalk-questdb on the boat).

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 5.1 (`solarEnergyToday`, `motorEnergyToday`), 7
- ARCHITECTURE 2.5

## Approach
Draft `EnergyCounter` kept, `History` class removed. Local midnight from
`environment.time.timezoneOffset` (`(-)hhmm`), else UTC; never the server TZ.
`lib/history.js` takes a `getHistoryApi` function so tests can fake it, asks
for `...EnergyToday:last` from local midnight to now, and returns the seed or
`undefined` on any error.

## Test Strategy
- trapezoid integration; gaps > 30 s not integrated
- rollover at ship midnight with offsets `200`, `-930`, `"0"`, missing
- seed used when the History API returns a value from today; ignored when it
  is from before midnight, `null`, throws, or the API is absent

## Implementation Steps
- [x] Trim `energy.js`, add the offset-aware day key
- [x] `lib/history.js` seed
- [x] Tests above

## Files to Create/Modify
`lib/energy.js`, `lib/history.js`, `test/energy.test.js`,
`test/history.test.js`
