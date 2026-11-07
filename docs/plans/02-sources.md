# Implementation Plan: Sources

## Overview
Turn the Signal K data tree into `Readings` once per tick (solar, motor,
propulsion, battery), with discovery, overrides and staleness.

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 4 (sources, staleness, gear ratio, propulsion path), 2.3 (in drive)
- ARCHITECTURE 2.2, 3

## Approach
`readSources(tree, config, now)` is pure: the caller passes
`app.getSelfPath('')`-style subtrees, so tests use plain objects. Built on the
draft `power.js` (`solarPowerFromNode`, `motorPowerFromNode`, `leafTime`).

## Notes
The recorded Signal K stream in the 2026-10-25 log carries no
`propulsion.99.direction`, so the fixture takes direction from the raw MQTT
`Motor/Direction` topic in the same log. A stale direction counts as absent.

## Test Strategy
Fixtures built from the 2026-10-25 laserbrain log (motordrive 99 and
`propulsion.99`) plus hand-made MPPT and battery trees:
- two MPPTs summed; one stale → excluded; all stale → solar `undefined`
- no MPPT → `electrical.venus.totalPanelPower` fallback flagged
- `electrical.solar.<id>.forecast.*` subtree ignored
- motor power from `power`, else `|V × I|`
- propulsion read from the configured path (default `propulsion.main`), RPM
  Hz → rpm, `gearRatio` only when finite > 0
- `inDrive`: direction ≠ 0 and power > idle; no direction → power only
- battery: first bank by default, configured id, sign inversion
- DC system power from the configured path (default `electrical.venus.dcPower`),
  stale like any other value
- override paths replace discovery one by one

## Implementation Steps
- [x] Extend `power.js` with a node-only (non-recursive) value read
- [x] `lib/sources.js`: solar, motor, propulsion, battery readers
- [x] Staleness from leaf timestamps vs `staleSeconds`
- [x] Fixture file `test/fixtures/curtis-2026-10-25.json` (trimmed, no
      hostnames or ids beyond the motordrive instance)
- [x] Tests above

## Files to Create/Modify
`lib/power.js`, `lib/sources.js`, `test/sources.test.js`,
`test/power.test.js`, `test/fixtures/*`
