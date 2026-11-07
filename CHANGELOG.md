# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
