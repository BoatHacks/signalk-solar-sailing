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
Decisions with Tobi, 2026-11-16 (mockup of the chart options:
project file `solar-sailing/mockups/plan12-chart-options.png`).

- **Day budget in the match panel**: a second, smaller number under the live
  budget ("day 410 W"), and a tick mark on `<ss-budget-bar>` at the day
  budget. Hidden when `dayBudget` is `null`.
- **"Today" line** under the day budget (Tobi, 2026-11-16): best hours and
  sunset, e.g. "best 11:00–14:00 · sunset 16:30", shown whenever the
  forecast or sunset is known. It comes from plan 10 alone, so it shows on
  boats without a speed log (the boat this winter); it does not depend on
  `<ss-range>`.
- **Forecast bias** shown in the house/budget breakdown as its own line with
  the predictor status ("forecast: surplus +120 W"), so the skipper can see
  why the budget moved.
- **`<ss-range>`** (new element), speed and course only:
  - speed at budget in kn and range until sunset in nm ("through water"),
    with the basis it uses (`rangeBasis`: "at day budget" / "at live
    budget");
  - with an active course, two lines: next waypoint and final destination.
    Waypoint line carries the current along the bearing (Tobi, 2026-11-16):
    "WP 3.1 nm, 13:05, current −0.4 kn" (`waypointCurrent`, minus = foul,
    omitted when unknown or the target is not `currentCorrected`).
    Destination line is labelled "through water" when not current-corrected:
    "Dest 14.2 nm, ETA 17:40, after sunset, needs 620 W (+140 W over day
    budget)". With a single-point course only one line is shown.
  - The whole panel reads the status poll (`snapshot.speedAtBudget`,
    `rangeUntilSunsetM`, `waypoint`, `destination`, `speed`): distances are
    not published as paths, and one source keeps the lines consistent.
  - States: learning (sample count, and the suggested STW factor with its
    spread when `stwFactorSuggested` is set, as promised in plan 11), after
    sunset, unknown (grey dash, never a 0). **Always shown** (Tobi,
    2026-11-16): with no STW and no learned model it is greyed out with
    dashes and "No speed log"; course lines then show distances only.
  - Phone: below the budget bar; desktop: beside the energy panel.
- **Sources tab**: current set (deg true) and drift (kn) with their source
  (`environment.current` or estimated), STW and the speed model state.
- **Chart: new "Today" window** (Tobi, 2026-11-16): a fourth toggle next to
  3 h / 6 h / 24 h, sunrise to sunset (falling back to 06:00 to sunset + 1 h
  when sunrise is unknown). Measured solar, budget and motor from the
  History API left of "now"; the forecast curve (average W per slot from
  `status.forecast`) dashed to the right; best hours as a shaded band; a
  sunset marker. The 3 h / 6 h / 24 h windows stay history only, unchanged.
  Without a forecast the Today window shows history up to now with the
  sunset marker; without sunset it is hidden.
- **Data**: day budget, Today line and forecast bias use the existing
  `plugin.solarsailing.*` subscription; the range panel, the forecast curve
  and sunrise (added to the snapshot for the chart) come with the existing
  5 s `status` poll. No new connection.
- **Units**: kn and nm via `displayUnits` (distance category `naut-mile`),
  deg for the set, with fallbacks in `units.js` for `m/s` → kn, `m` → nm and
  `rad` → deg if the server lacks them; times in ship time (`time.js`).

## Test Strategy
- `units.js`: m/s → kn, m → nm, rad → deg, fallback when `displayUnits` is missing.
- `state.js` / view tests: every new element hidden with no data; learning
  and after-sunset states; `null` renders a dash.
- Chart path builder: Today window bounds (sunrise to sunset, fallback);
  future segment, band and marker positions for a fixed `now`; no future
  segment without forecast; 3/6/24 h output unchanged.
- `<ss-range>`: hidden without STW and model; waypoint current sign and
  omission; destination "through water" label; basis label.
- `npm run lint` (ES2017) and screenshots in day, night, phone, desktop and
  offline, with and without forecast data (`scripts/screenshots.mjs` gains a
  forecast fixture); read them before committing.

## Implementation Steps
Done in PR #9 (squash-merged 2026-11-17, not released). Also added there (Tobi, 2026-11-17): one RPM card with target vs current motor RPM, target and current shaft RPM below.

- [x] Units and state keys for the new paths
- [x] Day budget and "Today" line in `<ss-match>`, tick in `<ss-budget-bar>`
- [x] Forecast bias line in the breakdown
- [x] `<ss-range>` (basis, waypoint current, learning hint with STW factor)
- [x] Sources tab: current, STW, speed model
- [x] Chart: "Today" window with forecast curve, best hours, sunset
- [x] Screenshots retaken; `signalk.screenshots` still two files; CHANGELOG

## Files to Create/Modify
`public/js/elements/range.js`, `public/js/elements/match.js`,
`public/js/elements/budget-bar.js`, `public/js/elements/sources.js`,
`public/js/elements/chart.js`, `public/js/units.js`, `public/js/state.js`,
`public/js/view.js`, `public/index.html`, `public/css/app.css`,
`scripts/screenshots.mjs`, `test/webapp/*.test.js`, `docs/screenshots/*`,
`CHANGELOG.md`
