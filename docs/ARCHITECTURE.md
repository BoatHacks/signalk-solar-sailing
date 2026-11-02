# signalk-solar-sailing Architecture

Requirements live in [SPEC.md](SPEC.md); this document only says how they are
built. Section numbers like "SPEC 2.3" point there.

## 1. Overview

One Signal K server plugin with no runtime dependencies. A 1 s tick reads the
current values from the server's data tree, runs pure maths, and fans the
result out to Signal K paths, a notification, a resource provider and (later)
control outputs. A buildless webapp in `public/` reads live values over the
Signal K WebSocket, the breakdown from the resources API, and history from the
server's History API.

```
 Signal K data tree (venus plugin, MPPTs, BMV/SmartShunt)
        │  app.getSelfPath(...)  every tick (1 s)
        ▼
 ┌──────────────┐   readings   ┌──────────────┐  snapshot  ┌────────────────────┐
 │ sources.js   │ ───────────▶ │ engine.js    │ ─────────▶ │ outputs/           │
 │ discover +   │              │ house load,  │            │  advisory.js       │──▶ plugin.solarsailing.*
 │ read + stale │              │ SoC bias,    │            │  (put.js later)    │──▶ notifications.…overBudget
 └──────────────┘              │ smoothing,   │            └────────────────────┘
                               │ match state  │
       ┌──────────────┐        │              │──▶ energy.js (today J)              
       │ propeller.js │◀──────▶│              │
       │ learn k      │        └──────────────┘──▶ resources.js ──▶ /signalk/v2/api/resources/solar-sailing/*
       └──────┬───────┘
              ▼ data dir: propeller.json
                                                    public/ webapp ◀── WS stream + resources API
```

## 2. System Components

All modules under `lib/` except `index.js` are free of Signal K I/O so they can
be unit-tested with plain objects.

### 2.1 Plugin entry (`index.js`)

Owns the lifecycle: `start(options)` builds the components from config,
registers metadata and the resource provider, loads the learned propeller
constant, and starts the tick with `setInterval`. `stop()` clears the timer,
saves the propeller model and publishes `matchState: unknown`. Each tick
step is wrapped in its own `try/catch → app.error`, so a failure in history or
publishing never stops the maths (signalk-plugin skill, section 2).

### 2.2 Sources (`lib/sources.js`, with `lib/power.js`)

Turns the data tree into readings (SPEC 4). Each tick it:

- walks `electrical.solar.*` and converts each node to watts with
  `solarPowerFromNode` (panelPower, then panelVoltage×panelCurrent, then
  voltage×current); falls back to `electrical.venus.totalPanelPower` when no
  charger is fresh;
- finds the motor power: configured path, else the first
  `electrical.motordrive.*` node, via `motorPowerFromNode`;
- reads RPM, direction, temperatures and `transmission.gearRatio` (if present)
  from the configured propulsion path, default `propulsion.main`; the admin UI
  field is a plain text path validated like the other overrides (section 6);
- reads battery SoC and power from the configured bank (first
  `electrical.batteries.*` by default), applying the configured sign;
- marks a reading stale when its timestamp is older than `staleSeconds`.

Reading the current value on a tick, rather than listening to deltas, is what
makes the venus plugin's duplicate deltas harmless (SPEC 11). Path overrides in
config replace discovery path by path.

`lib/power.js` is the parked draft, converted to ESM exports.

### 2.3 Engine (`lib/engine.js`, with `lib/matcher.js`)

Stateful but I/O-free. Input: readings and `now`. Output: a `Snapshot`
(section 3). Per tick:

1. Solar = sum of fresh sources, or `undefined` if none are fresh.
2. House load = `solar − battery − motor` when all three are fresh, clamped at
   ≥ 0 and smoothed with the same time constant; else the configured fallback
   (SPEC 2.1). The snapshot records which one was used.
3. SoC bias from `batteryBias` (SPEC 2.2).
4. Budget = smoothed(`solar − house + bias`), clamped to `[0, maxMotorPowerW]`.
5. Balance, match state with `verdict` (SPEC 2.3); `unknown` when not in drive
   or when solar or motor is missing.
6. Target RPM from the propeller model, or `undefined` until it is learned;
   target shaft RPM = target RPM ÷ gear ratio when the ratio is a finite
   number > 0. The propeller model itself always works in motor RPM.
7. Over-budget timer: `over` must persist `overBudgetDelaySeconds` while in
   drive before the snapshot sets `alarm: true`.

From the draft `matcher.js` we keep `Smoother`, `batteryBias`, `clamp` and
`verdict`. `recommend`, `rampLimit` and `shouldSend` move to the post-MVP put
output (2.7), and `MODES` is dropped, because the MVP has a single advisory
output.

### 2.4 Propeller model (`lib/propeller.js`)

Learns `k` and `n` in `P = k · rpmⁿ` (SPEC 2.4).

- **Sample** only in steady state: in drive, RPM above a floor (200 rpm), and RPM
  and power each within ±5 % of their mean over the last 10 s.
- **Fit**: keep the last 300 accepted (rpm, P) pairs in a ring buffer, bucketed
  by 25 rpm so one long cruise at a single speed can't crowd out the rest.
  Fit `ln P = ln k + n · ln rpm` with a robust line fit (Theil–Sen: median of
  pairwise slopes), which ignores waves or a fouled-line moment better than
  least squares.
- **Exponent guard**: `n` is fitted only when the samples cover at least 4
  buckets and a max/min RPM ratio of 1.5; otherwise `n` stays at the fallback
  (3) and only `k` is fitted (median of `P / rpmⁿ`). `n` is clamped to 1–3.5.
- **Ready** after 30 samples; before that, the configured fallback is used
  if set, else target RPM is hidden.
- **Persist** `{ k, n, samples, updatedAt }` to `<dataDir>/propeller.json` every
  5 min and on stop. A config button "reset learned propeller" clears it
  (for example after a prop change).

### 2.5 Energy today (`lib/energy.js`)

`EnergyCounter` from the draft integrates solar and motor W into J, resets at
local midnight and skips gaps > 30 s. The draft's `History` ring buffer is
dropped: history comes from the server's History API (SPEC 7).

On start, `lib/history.js` calls `app.getHistoryApi?.()` (optional; absent on
older servers or with no provider) and requests
`plugin.solarsailing.solarEnergyToday:last` and `motorEnergyToday:last` from
local midnight to now. A value found seeds the counter; any error or `null`
leaves it at 0. This is one request per start, never on the tick.

Local midnight comes from `environment.time.timezoneOffset` when present
(same rule as the webapp), else UTC midnight, not the server's TZ.

### 2.6 Advisory output (`lib/outputs/advisory.js`)

Publishes the snapshot as one delta on `plugin.solarsailing.*` (SPEC 5.1)
via `app.handleMessage`, but only on change or every 5 s, to keep the delta
rate low on the Cerbo. Raises and clears
`notifications.solarsailing.overBudget` from the snapshot's
`alarm` flag, sending a notification only on a state change.

Metadata is registered once at start with `app.setDefaultMetadata` (or a
meta delta on older servers): `units` (`W`, `J`, `Hz`, `ratio`),
`displayUnits` categories so the webapp and KIP show W/kW, kWh and RPM, and a
timeout of about 15 s so a dead plugin is visible as stale.

### 2.7 Output interface (post-MVP hook)

```js
/** @typedef {{ name: string,
 *    update(snapshot: Snapshot, now: number): void,
 *    stop(): void }} Output */
```

The entry holds a list of outputs; the MVP list is `[advisory]`. A later
`put.js` sends the budget to a configured writable path with `app.putSelfPath`,
using the draft's `rampLimit` (rise slowly, fall at once) and `shouldSend`
(deadband, minimum interval, refresh), and sends a configured release value
on `stop()`. An `n2k.js` output would sit in the same list (section 9).

### 2.8 Resource provider (`lib/resources.js`)

`app.registerResourceProvider({ type: 'solar-sailing', methods })` with
`listResources` → `{ status }`, `getResource('status')` → latest
snapshot plus per-source breakdown. `setResource` and `deleteResource` reject. This makes the data readable
anonymously under `allow_readonly`, unlike plugin routes (SPEC 5.2).

### 2.9 Webapp (`public/`)

Built to the signalk-visuals skill with a **Chromium 69 floor** (SPEC 11).

- **Vanilla custom elements**, no framework, native ES modules with relative
  imports, no bundler. ES2017 in our own code: no `?.`, `??`, class fields,
  `Object.fromEntries`, `Array.prototype.at`. `clamp()` always after a plain
  fallback declaration; spacing with grid `gap` or margins, not flexbox `gap`.
- **No runtime dependencies to vendor.** The chart is a hand-written SVG
  (three polylines and an axis), cheaper than shipping a chart library that
  would itself need to run on Chromium 69.
- **Elements**, each built once with cached nodes and updated by
  `textContent` / attributes only:
  - `<ss-match>` match state word, icon and balance; panel class from state.
  - `<ss-budget-bar>` motor draw against budget, scaled to max motor power or
    the day's peak.
  - `<ss-value>` generic big-number panel (solar, motor, target RPM with shaft RPM
    beneath when known, house).
  - `<ss-sources>` per-MPPT, motor and battery breakdown.
  - `<ss-chart>` last 3 / 6 / 24 h of solar, motor and budget.
  - `<ss-energy>` solar in vs motor used today.
  - `<ss-topbar>`, `<ss-offline>` chrome and the offline banner.
- **Data layer** (`public/js/`):
  - `stream.js` — one WebSocket, `subscribe=none`, then one subscription to
    `plugin.solarsailing.*` (period 1000 ms), `environment.mode` and
    `environment.time.timezoneOffset` (5000 ms); exponential backoff 1 s→60 s
    with 20 % jitter; parses deltas defensively.
  - `api.js` — fetches `status` once on load (breakdown) and the chart window
    from `/signalk/v2/api/history/values` (solar, motor and budget paths,
    `resolution` scaled to the window) every 60 s, paused while
    `document.hidden`. A 404/501 or empty provider list shows "no history
    provider" in the chart panel instead of an empty chart.
  - `units.js` — reads `meta.displayUnits` per path, safe recursive-descent
    formula parser (no `eval`), ISO-prefix fallback.
  - `time.js` — ship time from `timezoneOffset`, else UTC with `Z`.
  - `state.js` — tiny store; elements subscribe to the keys they show.
- **Layout**: below 900 px one column, match panel and budget bar first, chart
  and breakdown under a tab bar; from 900 px a grid with the chart beside the
  live panels. 48 px targets.
- **Staleness**: the webapp greys a panel when its value is older than 15 s or
  the socket is down, independent of the server's own `unknown`.

## 3. Data Models

JSDoc typedefs in `lib/types.js`, checked by `tsc --noEmit`.

```js
/** @typedef {{ id: string, path: string, watts: number, via: string,
 *    time: number, stale: boolean }} SolarReading */
/** @typedef {{ id: string, watts?: number, rpm?: number, direction?: number,
 *    gearRatio?: number, inDrive: boolean, temperatures: Object<string, number>, time?: number,
 *    stale: boolean }} MotorReading */
/** @typedef {{ id: string, soc?: number, watts?: number, time?: number,
 *    stale: boolean }} BatteryReading */
/** @typedef {{ solar: SolarReading[], solarFallback: boolean,
 *    motor?: MotorReading, battery?: BatteryReading }} Readings */
/** @typedef {'matched'|'over'|'under'|'unknown'} MatchState */
/** @typedef {{ t: number, solarW?: number, houseW?: number,
 *    houseDerived: boolean, socBiasW: number, budgetW?: number,
 *    motorW?: number, balanceW?: number, matchState: MatchState,
 *    targetRpm?: number, targetShaftRpm?: number, alarm: boolean,
 *    solarEnergyJ: number, motorEnergyJ: number }} Snapshot */
```

Internally RPM is rpm (what the propeller law and logs use); the advisory
output converts to Hz for `targetRevolutions`.

## 4. Technology Stack

| Part | Choice | Why |
|------|--------|-----|
| Plugin language | JavaScript ES modules (`"type": "module"`, default-export plugin factory), Node ≥ 18, Signal K server ≥ 2.14 | Same module style as the webapp, no build; the draft lib is converted from CommonJS |
| Type checking | JSDoc + `tsc --noEmit --checkJs` (dev only) | Types without a compile step (signalk-visuals 1) |
| Runtime deps | none | App-store installs skip scripts; less to audit |
| Webapp | Vanilla custom elements, ES2017 modules, hand-made SVG | Chromium 69 floor, buildless |
| Tests | `node:test` + `node:assert` | Zero-dependency; covers lib and webapp helpers |
| Lint | ESLint with `ecmaVersion: 2017` on `public/` | Catches syntax the plotter can't parse |
| Screenshots | Playwright (dev only) | Day, night, phone, desktop, offline (signalk-visuals 12) |
| CI | GitHub Actions: lint, typecheck, test | |
| Licence | EUPL-1.2 | Tobi's choice; any dependency must be EUPL-compatible (MIT, BSD, ISC, Apache-2.0) |
| Publish | npm OIDC trusted publishing on release | `npm-oidc-publish` / `plugin-release` skills |

## 5. Integration Points

| System | Contract |
|--------|----------|
| signalk-venus-plugin | Reads `electrical.motordrive.<id>.*`, `propulsion.<id>.*` (needs PR #210; plugin default is `propulsion.main`, configurable), `electrical.solar.*`, `electrical.batteries.*`, `electrical.venus.totalPanelPower` |
| Server `baseDeltas.json` | Optional `<propulsion path>.transmission.gearRatio` |
| Other MPPT plugins | Any `electrical.solar.<id>` with power or V/I |
| Signal K server | `getSelfPath`, `handleMessage`, `setDefaultMetadata`, `registerResourceProvider`, `getDataDirPath`, `savePluginOptions` (not used for `k`) |
| Webapp / KIP / alarms | Published paths and notification (SPEC 5.1) |
| History provider (Tobi's boat: signalk-questdb; also signalk-to-influxdb2, signalk-parquet) | Records `plugin.solarsailing.*`; the plugin and webapp read it via `/signalk/v2/api/history` |
| signalk-to-nmea2000 (later) | Maps our paths to PGNs (section 9) |

## 6. Security Considerations

- The MVP never writes to anything except its own paths, its notification and
  its data-dir file; it cannot affect the motor.
- The resource provider is read-only; write methods reject.
- Config values are validated by the schema; path overrides are matched
  against `^[A-Za-z0-9_.]+$` before use.
- The webapp needs read access only. With Signal K security on and
  `allow_readonly` off, it shows the offline banner with a "login needed" note.
- The future `put` output is opt-in, off by default, needs an explicit target
  path and a max-power clamp, and releases on stop.

## 7. File Structure

```
signalk-solar-sailing/
├── index.js                 plugin entry, lifecycle, tick
├── lib/
│   ├── types.js             JSDoc typedefs
│   ├── config.js            schema + defaults + validation
│   ├── power.js             tree → watts (draft)
│   ├── sources.js           discovery, readings, staleness
│   ├── matcher.js           smoothing, SoC bias, verdict (draft, trimmed)
│   ├── engine.js            snapshot per tick
│   ├── propeller.js         k learning + persistence
│   ├── energy.js            energy today (draft, History class removed)
│   ├── history.js           History API seed for today's energy
│   ├── resources.js         resource provider
│   └── outputs/advisory.js  paths, metadata, notification
├── public/
│   ├── index.html
│   ├── icon.png             512 px, = signalk.appIcon
│   ├── css/app.css
│   └── js/{app,stream,api,state,units,time}.js + elements/*.js
├── test/
│   ├── fixtures/curtis-2026-10-25.json   trimmed from laserbrain logs
│   └── *.test.js
├── docs/
│   ├── SPEC.md
│   ├── ARCHITECTURE.md
│   ├── IMPLEMENTATION_CHECKLIST.md
│   ├── plans/           one plan per build step (00-roadmap.md first)
│   ├── icon-prompt.md
│   └── screenshots/
├── .github/workflows/{test.yml,publish.yml}
├── package.json             keywords: signalk-node-server-plugin, signalk-webapp
├── LICENSE
└── README.md
```

## 8. Deployment

- Install from the Signal K app store or `npm install` in `~/.signalk`.
  Requires signalk-venus-plugin with PR #210 for RPM and target RPM; without it
  everything except target RPM still works.
- Webapp appears in the server's webapp list at
  `/signalk-solar-sailing/`; on the MFD, open the same URL in its browser.
- Persisted state: plugin config in `plugin-config-data/`, learned propeller
  constant in the plugin data dir (`getDataDirPath()`), never in
  `node_modules`.
- Load on the Cerbo: one 1 s tick reading about 20 values, a delta at most
  once a second, one History API query at start. Negligible.

## 9. Future Considerations

- **N2K PGNs for the plotter.** Paths are flat SI values, so a
  signalk-to-nmea2000 mapping (or an `n2k.js` output emitting
  `nmea2000JsonOut`) can send, for example, PGN 127488 as a virtual engine
  instance with target RPM, and 127508/127751 for balance, without changing
  paths. Which PGN the plotter actually renders needs on-board testing.
- **Solar forecast** (SPEC 9.2): a `lib/forecast.js` reader for
  `electrical.energy.prediction.*` that adds optional fields to `Readings`;
  the engine computes a day budget beside the live one and adjusts the SoC
  bias from `status` / `timeToFull`. Absent data leaves today's behaviour
  untouched, so it needs no change to the paths or the tick.
- **Motor control** via the `put` output (2.7) once a writable limit exists.
- **Range estimate**: needs speed through water; the engine snapshot already has
  budget and target RPM to fit speed against.
