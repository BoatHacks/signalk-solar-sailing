# Implementation Plan: Webapp

## Overview
The cockpit and chart-plotter dashboard in the signalk-visuals style, running
on Chromium 69.

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 6
- ARCHITECTURE 2.9
- signalk-visuals skill (BoatHacks/claude-skills), sections 1–12

## Approach
Vanilla custom elements, buildless ES2017 modules, no vendored libraries.
Order of work: pure helpers first (testable in Node), then the data layer,
then elements, then layout.

## Test Strategy
- unit (`node:test`): formula parser, ISO-prefix formatting, timezone offset
  and time/date formatting, backoff schedule, panel state from value + age,
  hash/tab state, history response → chart points
- lint: ESLint `ecmaVersion: 2017` on `public/`
- headless screenshots (Playwright, dev only) against a dev server: day,
  night, phone 390 px, desktop 1280 px, offline (WebSocket refused), and no
  history provider; images read before calling it done
- smoke test on a Chromium 69 engine if one is available (or the plotter)

## Implementation Steps
- [ ] `public/js/units.js`, `time.js`, `backoff` in `stream.js`, `state.js`
- [ ] `stream.js`: one WebSocket, subscriptions with `period`/`minPeriod`,
      offline banner state
- [ ] `api.js`: `status` resource; History API window for the chart, paused
      while hidden; "no history provider" state
- [ ] Elements: `ss-topbar`, `ss-offline`, `ss-match`, `ss-budget-bar`,
      `ss-value`, `ss-sources`, `ss-chart` (SVG), `ss-energy`
- [ ] `css/app.css`: palette variables with `-rgb` triplets, day/night from
      `environment.mode`, panels and brackets, grey when stale, reduced motion
- [ ] Layout: one column with tab bar below 900 px, grid above; 48 px targets
- [ ] `index.html`: `data-mode="day"`, theme-color `#080a0c`, icon link,
      viewport, noscript
- [ ] Screenshots into `docs/screenshots/` with the file names listed in
      `signalk.screenshots` (`phone-day.png`, `desktop-night.png`, plus the rest
      for the README)

## Files to Create/Modify
`public/index.html`, `public/css/app.css`, `public/js/*.js`,
`public/js/elements/*.js`, `test/webapp/*.test.js`,
`scripts/screenshots.mjs`, `docs/screenshots/*`
