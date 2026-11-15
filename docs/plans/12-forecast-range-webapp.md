# Implementation Plan: Webapp for forecast and range

## Overview
Show the plan 10 and 11 values in the cockpit/plotter webapp without
crowding the on-watch view, and hide every new element when its data is
absent so a boat without the predictor or a log sees today's page.
Shared design: [09](09-forecast-and-range.md).

## Relevant SPEC/ARCHITECTURE Sections
- SPEC 6 (UI), 11 (Chromium 69 floor)
- ARCHITECTURE 2.9

## Approach
- **Day budget in the match panel**: a second, smaller number under the live
  budget ("day 410 W"), and a tick mark on `<ss-budget-bar>` at the day
  budget. Hidden when `dayBudget` is `null`.
- **Forecast bias** shown in the house/budget breakdown as its own line
  ("forecast: surplus +120 W"), so the skipper can see why the budget moved.
- **`<ss-range>`** (new element): speed at budget in kn, range until sunset
  in nm, sunset time, and the waypoint line ("WP 14.2 nm, ETA 15:40" or
  "needs 620 W"). States: learning (sample count), no log, after sunset,
  unknown (grey dash, never a 0). Phone: below the budget bar; desktop:
  beside the energy panel.
- **Chart**: the forecast curve (average W per hour from `status.forecast`)
  as a dashed line to the right of "now", the best-hours window as a shaded
  band, and a sunset marker. The SVG gains a "future" segment; the 3 h / 6 h
  windows show the next 3 h / 6 h of forecast, 24 h shows until sunset.
- **Data**: the new paths arrive over the existing `plugin.solarsailing.*`
  subscription; the forecast curve comes with the existing 5 s `status`
  poll. No new connection.
- **Units**: kn and nm via `displayUnits`, with an ISO-prefix fallback in
  `units.js` for `m/s` → kn and `m` → nm if the server lacks them; times in
  ship time (`time.js`).

## Test Strategy
- `units.js`: m/s → kn, m → nm, fallback when `displayUnits` is missing.
- `state.js` / view tests: every new element hidden with no data; learning
  and after-sunset states; `null` renders a dash.
- Chart path builder: future segment, band and marker positions for a fixed
  `now`; no future segment without forecast.
- `npm run lint` (ES2017) and screenshots in day, night, phone, desktop and
  offline, with and without forecast data (`scripts/screenshots.mjs` gains a
  forecast fixture); read them before committing.

## Implementation Steps
- [ ] Units and state keys for the new paths
- [ ] Day budget in `<ss-match>` and `<ss-budget-bar>`
- [ ] Forecast bias line in the breakdown
- [ ] `<ss-range>`
- [ ] Chart: forecast curve, best hours, sunset
- [ ] Screenshots retaken; `signalk.screenshots` still two files; CHANGELOG

## Files to Create/Modify
`public/js/elements/range.js`, `public/js/elements/match.js`,
`public/js/elements/budget-bar.js`, `public/js/elements/sources.js`,
`public/js/elements/chart.js`, `public/js/units.js`, `public/js/state.js`,
`public/js/view.js`, `public/index.html`, `public/css/app.css`,
`scripts/screenshots.mjs`, `test/webapp/*.test.js`, `docs/screenshots/*`,
`CHANGELOG.md`
