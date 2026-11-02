# signalk-solar-sailing Specification

## 1. Introduction

### 1.1 Purpose

A Signal K server plugin for electric-drive boats that shows how much power the
sun is delivering, how much the electric motor is drawing, and what motor power
(and roughly what RPM) the boat can sustain on solar alone. The goal is to let
the skipper motor "on the sun" without slowly draining the house bank.

The first version is **advisory**: it computes and displays a target and warns
when the motor draws more than the budget. It never commands the motor. The
design keeps a pluggable output so a real power/throttle limit can be added once
the boat has a writable control point (see 9.2).

### 1.2 Background

- The reference boat runs a Curtis motor controller on VE.Can, seen by a Victron
  Cerbo GX as `com.victronenergy.motordrive` instance 99, on a ~48 V bank
  (53.4-53.6 V while engaged). Logs: BoatHacks/laserbrain `electric-motor-logs/`.
- `sbender9/signalk-venus-plugin` maps the motordrive's DC values to
  `electrical.motordrive.<id>.{power,current,voltage}`. Tobi's PR #210 adds
  `propulsion.<id>.{revolutions,temperature,controllerTemperature,torque,direction}`.
  PR #211 fixes a double-subscription that delivers every MQTT value twice.
- Victron MPPTs appear as `electrical.solar.<id>.{panelPower,panelVoltage,panelCurrent,...}`;
  the Cerbo also publishes a system total `electrical.venus.totalPanelPower`.
- As far as we know the Cerbo exposes the Curtis read-only: there is no
  setpoint path to write a power or throttle limit to.

### 1.3 Terminology

- **Solar input** — total PV power currently harvested, in W.
- **House load** — DC power consumed by everything except the propulsion motor.
- **SoC bias** — a W adjustment based on battery state of charge: negative
  (hold power back for charging) when the bank is low, positive (allow the
  battery to help) when it is nearly full.
- **Solar budget** — the motor power the boat can sustain:
  `solar input − house load + SoC bias`, clamped to `[0, max motor power]`.
- **Balance** — `solar budget − motor power`. Positive: running under the sun.
  Negative: drawing from the bank beyond plan.
- **Match state** — `matched`, `over`, `under`, or `unknown` (see 2.3).
- **Target RPM** — the motor RPM estimated to draw exactly the solar budget.
  With a known gear ratio, also shown as **target shaft RPM** (motor RPM ÷ ratio).

## 2. Domain Rules

### 2.1 Power accounting

House load is taken from the first source that is fresh, in this order:

1. **DC system power** (configurable path, default `electrical.venus.dcPower`,
   the Cerbo's `/Dc/System/Power`). On the reference boat it includes the
   Curtis draw (confirmed on board, 2026-11-02), so
   `house = dcSystem − motor`. A setting "DC system power includes the
   motor" (default on) covers installs where it doesn't (`house = dcSystem`).
2. **Energy balance** on the DC bus: `solar = battery charge power + motor +
   house`, so with battery power measured (positive = charging),
   `house = solar − battery − motor`.
3. **Configured constant** house load.

House load is clamped at ≥ 0. The Cerbo figure comes first because it is one
consistent, already-signed value from the GX instead of a sum of three
readings with their own timestamps and sign conventions.

### 2.2 SoC bias

| SoC | Bias |
|-----|------|
| ≤ `socLow` (default 50 %) | `−chargeReserveW` (default 100 W) |
| ≥ `socHigh` (default 90 %) | `+batteryAssistW` (default 0 W) |
| between | linear interpolation |
| unknown | 0 |

### 2.3 Match state

With tolerance `max(50 W, 10 % of budget)`:
`over` when motor > budget + tolerance, `under` when motor < budget − tolerance,
otherwise `matched`. `unknown` if solar or motor data is missing or stale.
Match state is only meaningful while the motor is **in drive**: direction ≠ 0
**and** motor power above an idle threshold (default 15 W). If the motor
publishes no direction, power alone decides. Outside drive the state is
`unknown`.

### 2.4 Propeller law

Motor power is modelled as a power law of motor RPM: `P ≈ k · rpmⁿ`. Target
RPM is `(budget / k)^(1/n)`. Both `k` and `n` are learned from live
(rpm, power) pairs while motoring in steady state. Ideal propeller theory
gives `n = 3`, but at low power fixed motor and controller losses flatten the
curve: the 2026-10-25 log fits `n ≈ 1.35` over 217–521 rpm (42–138 W). So
`n` starts at 3, is only fitted once the samples span a wide enough RPM range,
and is clamped to 1–3.5.

### 2.5 Smoothing

Solar input changes fast under passing clouds. The budget uses an exponential
moving average (default time constant 30 s) so the target doesn't jump around.
Motor power is shown raw and smoothed.

### 2.6 Active and idle

The plugin runs at two rates:

- **Active** (motor in drive, see 2.3): calculations every 1 s.
- **Idle**: after the motor has been out of drive for `idleAfterSeconds`
  (default 30 s), or its data is stale, calculations run every 10 s. Solar
  input, house load, SoC and today's energy stay current; match state is
  `unknown`, the budget smoother, propeller learning and the over-budget timer
  pause.
- **Wake**: the first motor power or direction update that shows the motor in
  drive switches back to active at once, without waiting for the next idle
  tick.

## 3. Data Model

- **Solar source** — id, source path, current W, how derived
  (`panelPower` | `panelVoltage*panelCurrent` | `voltage*current`), last update.
- **Motor** — id, power W (from `power`, else `|voltage × current|`), RPM,
  direction, temperatures, gear ratio (optional), last update.
- **Battery** — id, SoC (ratio), power W (charging positive), last update.
- **Snapshot** — solar input, house load (and its source: `dcSystem`,
  `balance` or `config`),
  SoC bias, solar budget, motor power, balance, match state, target RPM,
  energy today (solar and motor, J).
- **History** — not stored by this plugin; read from the Signal K History API
  (see 7).

## 4. Sources / Inputs

- **Solar**: sum of every `electrical.solar.*` source. Fallback to
  `electrical.venus.totalPanelPower` only when no individual charger reports.
  Only a node's own live values count; nested subtrees such as
  `electrical.solar.<id>.forecast.*` (signalk-solar-forecast) are ignored.
- **Motor power**: auto-discover `electrical.motordrive.*` (first found),
  overridable to an explicit path for non-Victron setups.
- **Propulsion**: RPM, direction and temperatures from a configurable
  propulsion subtree, default `propulsion.main`. The venus plugin publishes the
  Curtis as `propulsion.99`, so either set that in the plugin config or map it
  to `main`.
- **Gear ratio** (optional): `<propulsion path>.transmission.gearRatio`
  (motor rotations per shaft rotation), usually set once in the server's
  `baseDeltas.json`. When present it is used to derive shaft RPM and target
  shaft RPM; when absent everything is shown in motor RPM only.
- **Battery**: one configured bank under `electrical.batteries.<id>`
  (first one found by default) for SoC and power.
- **Staleness**: a value older than `staleSeconds` (default 10 s) is ignored. If
  all solar sources are stale, the budget is `unknown`, never zero, so a data
  dropout is not mistaken for a cloud.
- **Duplicate deltas** (venus plugin ≤ 2.4.1): harmless, because the plugin reads
  the current value on a fixed tick instead of counting deltas.

## 5. API Specification

### 5.1 Published Signal K paths

All under `plugin.solarsailing.` (self vessel), with `meta.units`:

| Path | Units | Meaning |
|------|-------|---------|
| `solarPower` | W | Solar input |
| `houseLoad` | W | House load (DC system, energy balance or configured) |
| `socBias` | W | SoC bias applied |
| `budget` | W | Solar budget (smoothed) |
| `motorPower` | W | Motor draw |
| `balance` | W | Budget − motor |
| `matchState` | — | `matched` / `over` / `under` / `unknown` |
| `targetRevolutions` | Hz | Target motor RPM (Signal K uses Hz) |
| `targetShaftRevolutions` | Hz | Target shaft RPM; only published when a gear ratio is known |
| `solarEnergyToday` | J | Solar energy since local midnight |
| `motorEnergyToday` | J | Motor energy since local midnight |

Notification `notifications.solarsailing.overBudget`, state `warn`,
when `over` persists for `overBudgetDelaySeconds` (default 60 s) while in drive.
Cleared (state `normal`) when back to `matched` or `under`.

### 5.2 Read API for the webapp

Served through the Signal K v2 resources API (anonymously readable, unlike
plugin routes, which are admin-only):

- `GET /signalk/v2/api/resources/solar-sailing/status` — snapshot plus
  per-source breakdown.
- History for the chart: `GET /signalk/v2/api/history/values?paths=plugin.solarsailing.solarPower,…&duration=PT6H`
  (server History API, answered by whichever history provider is installed).

### 5.3 Control output (post-MVP hook)

An internal output interface receives the budget each tick. MVP ships only the
`advisory` output (publishes paths and notification). A later `put` output would
send the budget to a configured writable path via the Signal K PUT API, with
ramp limits and a release value when disabled.

## 6. User Interface

A webapp served by the plugin, in the boat's "tactical console" style (the
`signalk-visuals` guideline, BoatHacks/claude-skills). Built for a phone or
tablet in the cockpit and the nav-station screen.

### 6.1 Content

- Big numbers: solar input, motor power, balance, target RPM (plus shaft RPM
  when a gear ratio is known); match state shown
  with an icon and word, not just colour.
- A "budget bar" comparing motor draw to the solar budget.
- Per-source breakdown (each MPPT, the motor, the battery).
- Chart of the last few hours: solar, motor, budget.
- Energy today: solar in vs motor used.

### 6.2 Look and behaviour

- **Dark in both modes.** Day/night follows `environment.mode` (day when absent);
  night dims every colour, there is no white mode.
- **State colours:** `matched` green, `under` teal, `over` orange (red once the
  over-budget notification is active). **Stale, missing or `unknown` data is
  neutral grey with a dash, never green**, matching the "stale solar means
  unknown" rule in 4.
- **Phone = on-watch:** single column, the match panel and budget bar first,
  48 px touch targets. **Desktop = nav-station:** grid with chart and breakdown
  beside the live panels.
- **Live data over one throttled WebSocket** (about 1 s for power values, 5 s
  for mode and slow values), with reconnect backoff and an offline banner that
  greys out every panel.
- **Units from path metadata.** Values are published in SI with
  `displayUnits`; the page shows W/kW, RPM and kWh. Times are ship time (from
  `environment.time.timezoneOffset`) or UTC with `Z`.
- **Works offline:** everything the page needs ships with the plugin.
- **Browser floor: Chromium 69**, so the page also runs in a Navico/B&G
  chart plotter's browser (see 11).

### 6.3 App icon

House style: four flat colours on navy, golden squirrel mascot (for example the
squirrel under a sun, at a tiller or with a propeller), 512 px PNG.

## 7. Persistence

- Plugin configuration, via the Signal K plugin config store.
- The learned propeller model (`k`, `n`), saved so it survives restarts.
- **History comes from the Signal K History API** (`/signalk/v2/api/history`),
  served by a history provider plugin such as signalk-to-influxdb2 or
  signalk-parquet that records `plugin.solarsailing.*`. The plugin keeps no
  history of its own.
- **Today's energy survives restarts** the same way: on start the plugin asks
  the History API for the last `solarEnergyToday` / `motorEnergyToday` value
  since local midnight and continues counting from it.
- Without a history provider, the chart shows "no history provider" and the
  energy counters start from 0 after a restart.

## 8. Configuration

| Setting | Default |
|---------|---------|
| Battery bank id | first found |
| Battery power sign | charging positive (invertible) |
| Max motor power | none (no clamp; budget bar scales to the day's peak) |
| Forward direction value | none (direction shown raw until set) |
| DC system power path | `electrical.venus.dcPower` |
| DC system power includes the motor | on |
| Fallback house load | 0 W |
| socLow / socHigh | 50 % / 90 % |
| chargeReserveW / batteryAssistW | 100 W / 0 W |
| Smoothing time constant | 30 s |
| staleSeconds | 10 s |
| overBudgetDelaySeconds | 60 s |
| Idle power threshold (in-drive) | 15 W |
| idleAfterSeconds | 30 s |
| Idle tick interval | 10 s |
| Propeller model fallback (`k`, `n`) | none / 3 (target RPM hidden until learned) |
| Propulsion path | `propulsion.main` |
| Path overrides (solar, motor power, battery) | auto-discover |

## 9. MVP Scope

### 9.1 MVP Features

- Auto-discover solar, motor and battery from the Victron/venus paths above.
- Compute solar budget with SoC bias and derived house load.
- Learn the propeller model (`k`, `n`) and show target RPM.
- Publish the `plugin.solarsailing.*` paths and the over-budget notification.
- Cockpit webapp with live values, breakdown, chart and energy today.
- Tests for all maths with recorded data from the laserbrain logs.
- **Signal K plugin registry score 100/100** from the first release (9.3).

### 9.3 Registry requirements

The [Signal K plugin registry](https://signalk.org/signalk-plugin-registry/)
re-tests every plugin nightly and scores it out of 100. The plugin ships
meeting every criterion:

| Criterion | Points | How we meet it |
|-----------|--------|----------------|
| Installs, loads, activates | 20 + 15 + 15 | Starts with default config on a server with no boat data and **no network** (the harness runs under `firejail --net=none`); missing data gives `unknown`, never an exception |
| Schema | 5 | Config schema is valid JSON Schema with defaults for every field |
| Tests pass | 25 | `npm test` passes offline with no services |
| Security audit | 20 | Zero runtime dependencies, committed `package-lock.json`, `npm audit --omit=dev` clean |
| Changelog | −5 if missing | `CHANGELOG.md` at the repo root, plus a GitHub Release per version |
| Screenshots | −5 if missing | `signalk.screenshots` in `package.json`, files under `docs/screenshots/` and listed in `files` |
| Plugin-CI | −10 if missing | Signal K's reusable `plugin-ci.yml` workflow, pinned to a release commit SHA |

Not scored, but required for the App Store listing:

- `signalk.displayName`: **"Solar Sailing"**.
- `signalk.appIcon`: `public/icon.png` (6.3).
- `signalk.recommends`: `signalk-venus-plugin` (motor, solar, battery, DC system
  power) and `signalk-questdb` (History API). Nothing in `signalk.requires`:
  every source can be overridden for non-Victron boats, and without a history
  provider only the chart is empty. `@meri-imperiumi/signalk-energy-predictor`
  is added when the forecast input (9.2) ships.
- GitHub repo description, homepage `https://www.npmjs.com/package/signalk-solar-sailing`,
  and topics `signalk`, `signalk-plugin`, `marine`, `solar`, `electric-propulsion`.

### 9.2 Post-MVP / Deferred

- **Motor control output** — needs a writable limit on the Curtis or extra hardware.
- **NMEA 2000 PGNs for the chart plotter** — plotters only render a few generic
  PGNs, so which one works needs testing on board. Candidates: 127488/127489
  (engine rapid/dynamic) as a virtual engine instance for target RPM and
  budget; 127508 (battery status) or 127751 (DC voltage/current) for balance.
  The published paths are shaped so a signalk-to-nmea2000 mapping can be added
  without changing them.
- **Solar forecast input** (optional, from
  `@meri-imperiumi/signalk-energy-predictor`, `electrical.energy.prediction.*`):
  - *Day budget*: (remaining forecast solar until sunset − forecast house
    energy) ÷ hours left, shown beside the live budget as a steadier target.
  - *Forecast-aware SoC bias*: raise the battery assist when `status` is
    `surplus` or `timeToFull` is near (energy that would be curtailed anyway);
    raise the charge reserve on `deficit` / `critical`.
  - *Best hours to motor*: forecast curve on the chart and a peak-sun hint.
  - *Range until sunset* at the current budget (feeds the range estimate).
  The plugin works unchanged when no forecast is published.
- **Range/speed estimate** ("at this budget you make X kn, reach Y by sunset").

## 10. References

- Signal K specification: electrical and propulsion schema.
- sbender9/signalk-venus-plugin, PRs #210 and #211.
- BoatHacks/laserbrain `electric-motor-logs/` (Curtis motordrive log, 2026-10-25).

## 11. Design Decisions

- **Advisory first, control later.** The motor can't be limited today, and an
  automatic limit on the only propulsion is a safety question worth taking slowly.
- **Sum chargers, Cerbo total as fallback.** Works with any MPPT brand and
  gives a per-array view; still works on a Cerbo-only setup.
- **House load from the Cerbo's DC system power first, battery balance
  second**, rather than requiring every consumer to be metered.
- **Read on a tick, don't count deltas**, so duplicated or bursty deltas can't
  skew values or energy totals.
- **Serve webapp data via the resources API**, because plugin routes need an
  admin token.
- **Stale solar means `unknown`, not 0**, so a sensor dropout never tells the
  skipper to stop the motor.
- **Webapp runs on the chart plotter (Chromium 69 floor).** The plotter is
  where the skipper looks while motoring; its browser is old, so the page is
  written to ES2017 and old-safe CSS. This also gives a plotter view long before
  the N2K PGN route (9.2) is tested on board.

- **All outputs in one plugin subtree** (`plugin.solarsailing.*`, notification
  `notifications.solarsailing.overBudget`). The schema has no slot for a solar
  budget, balance or match state; keeping them together makes clear they are
  this plugin's derived values, not device readings (Tobi, 2026-11-02).

- **ES modules, JSDoc types, zero runtime dependencies**; requires Signal K
  server 2.14+ (Tobi, 2026-11-02).

- **Use the server's History API instead of our own store**, so history lives
  in one place, survives restarts and is available to other apps (Tobi,
  2026-11-02).

- **Slow down while the motor is off** (10 s idle tick, woken by motor
  deltas) instead of stopping, so solar energy and the webapp stay current
  at a tenth of the work (Tobi, 2026-11-02).

- **Registry 100/100 as a release gate**, so the plugin is trusted in the App
  Store and regressions show up in the nightly re-test (Tobi, 2026-11-02).

## 12. Open Questions

None blocking. Three boat facts are deliberately left as configuration rather
than hard-coded (section 8): Curtis max continuous power, the battery bank id
and its power sign, and which `direction` value means forward.
