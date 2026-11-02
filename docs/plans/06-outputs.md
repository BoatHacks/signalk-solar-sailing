# Implementation Plan: Outputs and wiring

## Overview
Publish the snapshot on `plugin.solarsailing.*`, raise the over-budget
notification, serve the status resource, and wire everything into the tick.
After this plan the plugin is usable without the webapp.

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 5.1, 5.2, 5.3, 7
- ARCHITECTURE 2.1, 2.6, 2.7, 2.8, 6

## Approach
`Output` interface with the single `advisory` output. One delta per change or
every 5 s. Metadata once at start (`units`, `displayUnits` category, timeout
≈ 15 s). `targetShaftRevolutions` only when a gear ratio is known. Resource
provider `solar-sailing` with read-only `status`. `index.js` runs the 1 s tick
with each step in its own `try/catch`, loads/saves the propeller model, seeds
energy, and publishes `matchState: unknown` on stop.

## Test Strategy
Fake `app` recording `handleMessage`, `setDefaultMetadata`,
`registerResourceProvider` calls:
- deltas carry only `plugin.solarsailing.*` paths in SI
- no delta when nothing changed for < 5 s
- notification `notifications.solarsailing.overBudget` sent once on raise and
  once on clear, state `warn` / `normal`
- resource `status` returns the last snapshot and breakdown; writes reject
- scheduler: 1 s while active, 10 s while idle; a wake delta (direction ≠ 0,
  power > idle) runs a tick at once; duplicate wake deltas don't double-tick;
  `stop()` clears the timer and the subscription
- a throwing step (e.g. history seed) doesn't stop the tick
- manual: run on a development Signal K server with the log fixture played
  in, check the data browser and KIP

## Implementation Steps
- [ ] `lib/outputs/advisory.js`
- [ ] `lib/resources.js`
- [ ] `index.js` lifecycle and tick scheduler (`setTimeout` chain, wake subscription)
- [ ] Tests above; manual run noted in the PR

## Files to Create/Modify
`index.js`, `lib/outputs/advisory.js`, `lib/resources.js`,
`test/advisory.test.js`, `test/resources.test.js`, `test/plugin.test.js`
