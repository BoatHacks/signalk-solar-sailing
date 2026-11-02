# Implementation Checklist

Work through this for every plan in [`docs/plans/`](plans/) (start with the
[roadmap](plans/00-roadmap.md)). [SPEC.md](SPEC.md) says what the plugin must
do, [ARCHITECTURE.md](ARCHITECTURE.md) says how it is built; the plans only
say in which order.

## 1. Explore
- [ ] Read the plan, and the SPEC and ARCHITECTURE sections it links
- [ ] Read the code the plan touches, and the draft modules it builds on
- [ ] Check the Signal K path shapes against a fixture (`test/fixtures/`) or
      the laserbrain logs, not from memory

## 2. Plan
- [ ] Note any change of approach in the plan file before coding
- [ ] List the test cases up front (normal, missing, stale, edge)

## 3. Test and implement
Tests are written with the code, not necessarily first, but a module isn't
done until its pure functions are covered.
- [ ] `lib/` modules stay free of Signal K I/O; only `index.js` and
      `lib/outputs/`, `lib/resources.js`, `lib/history.js` touch `app`
- [ ] Unit-test with `node:test` and recorded data where it exists
- [ ] Run `npm test`, `npm run lint`, `npm run typecheck` while working
- [ ] A wrong test is fixed on purpose, never loosened to get green

## 4. Verify
- [ ] Missing or stale input gives `unknown` / grey, never 0 or green
- [ ] Units are SI on every published path and `meta.units` is set
- [ ] Webapp code: ES2017 only (no `?.`, `??`, class fields,
      `Object.fromEntries`, `Array.prototype.at`), `clamp()` after a plain
      fallback, no flexbox `gap`; `npm run lint` enforces the syntax part
- [ ] Webapp change: headless screenshots in day, night, phone, desktop and
      offline, and read them (signalk-visuals section 12)
- [ ] Run against a development Signal K server, never the boat's live one

## 5. Document and commit
- [ ] Update SPEC.md / ARCHITECTURE.md if the change contradicts them
- [ ] Tick the plan's steps; mark the plan done in the roadmap
- [ ] No temporal wording in comments ("new", "for now")
- [ ] Commit message says why; one plan per commit or PR where practical

## Common mistakes
- Counting deltas instead of reading the current value on the tick
- Treating a data dropout as 0 W of sun
- Hard-coding `propulsion.99`, a battery id or a forward direction value
- Adding a runtime dependency (zero allowed; dev-only is fine, EUPL-compatible)
