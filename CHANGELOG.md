# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Optional solar forecast from `@meri-imperiumi/signalk-energy-predictor`
  (plan 10). Without it, and with default settings, nothing changes.
  - Forecast bias on the solar budget: up to +300 W while the bank will fill
    anyway, −100 W on `deficit`, −200 W on `critical` (all configurable).
  - Day budget until sunset, SoC-neutral by default or aimed at a sunset
    target SoC (off by default) with a night reserve above the minimum SoC.
  - Best 3 h window to motor today, sunset from the boat's position.
  - New paths `plugin.solarsailing.forecastBias`, `dayBudget`,
    `dayBudgetBasis`, `sunsetTargetSoc`, `solarRemaining`, `houseRemaining`,
    `sunset`, `bestHoursStart`, `bestHoursEnd`, and a trimmed forecast curve
    in the status resource.
  - The forecast is kept from a subscription, because the server nulls the
    predictor's hourly values after 60 s.
- Range and speed estimate (plan 11). Hidden until a speed log has taught
  the speed model, so nothing changes without one.
  - Learns speed through water against motor power (`v = c · Pᵐ`, `m` from
    ⅓) from steady motoring, never while sailing; stored in `speed.json`,
    with a reset switch and an optional fallback `c`, `m`.
  - STW correction factor for a fouled log (default 1.0), plus a suggested
    factor from SOG/STW over several headings in the status resource.
  - New paths `plugin.solarsailing.speedAtBudget`, `rangeUntilSunset`,
    `rangeBasis`, and, with an active course, `waypointEta`,
    `waypointRequiredPower`, `destinationEta`, `destinationRequiredPower`
    (distances from course-provider).

## [0.1.2] - 2026-11-15

### Fixed

- House load flipped between the DC system power and the configured fallback
  every few seconds at anchor, because Victron Venus sends DC system power and
  battery values only when they change and they were dropped after 10 s. These
  values now count as current for `changeOnlyStaleSeconds` (new setting,
  default 120 s).

## [0.1.1] - 2026-11-15

### Fixed

- House load fell back to the configured value (0 W by default) whenever the
  motor controller published nothing, for example while switched off, so the
  solar budget was too high at anchor. A motor with no data at all now counts
  as 0 W for the DC system and battery balance formulas; a stale motor still
  makes them unavailable.

## [0.1.0] - 2026-11-08

### Added

- Plugin scaffold: ES module plugin, config schema with defaults, EUPL-1.2.
- Source discovery for solar chargers, motor drive, propulsion, battery and DC
  system power, with staleness and path overrides.
- Engine: house load, SoC bias, smoothed solar budget, balance, match state,
  over-budget timer, active/idle mode.
- Learned propeller model (`P = k · rpmⁿ`) with target motor and shaft RPM,
  saved in the plugin data directory.
- Energy today (solar and motor), seeded from the History API on start.
- Published `plugin.solarsailing.*` paths with metadata, the
  `notifications.solarsailing.overBudget` notification and the
  `solar-sailing/status` resource.
- Cockpit webapp: match state, motor-vs-budget bar, live values, energy
  today, 3 / 6 / 24 h chart from the History API and a per-source breakdown.
  Day and night mode, phone and nav-station layouts, offline banner, works on
  Chromium 69 chart plotters.
- App icon, screenshots and the npm publish workflow.

[Unreleased]: https://github.com/BoatHacks/signalk-solar-sailing/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/BoatHacks/signalk-solar-sailing/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/BoatHacks/signalk-solar-sailing/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/BoatHacks/signalk-solar-sailing/releases/tag/v0.1.0
