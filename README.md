# Solar Sailing (signalk-solar-sailing)

A [Signal K](https://signalk.org) server plugin for electric-drive boats. It
shows how much power the sun delivers, how much the motor draws, and what motor
power (and roughly what RPM) the boat can sustain on solar alone, so you can
motor "on the sun" without slowly draining the house bank.

It is **advisory**: it publishes a solar budget, a match state and a target RPM,
and raises a notification when the motor stays over budget. It never commands
the motor.

> Status: the plugin computes and publishes everything below. The cockpit
> webapp, app icon and screenshots follow in the next release.

## Requirements

- Signal K server 2.14 or newer, Node 22 or newer.
- Motor, solar and battery data, for example from
  [signalk-venus-plugin](https://www.npmjs.com/package/signalk-venus-plugin)
  on a Victron Cerbo GX. Target RPM needs the motor's `propulsion.<id>.revolutions`
  (venus plugin PR #210).
- Optional: a History API provider such as
  [signalk-questdb](https://www.npmjs.com/package/signalk-questdb), so today's
  energy survives restarts.

## How it works

Every second while the motor is in drive (every 10 s otherwise) the plugin
reads the current values and computes:

- **Solar input**: sum of every `electrical.solar.*` charger, falling back to
  `electrical.venus.totalPanelPower`. Stale data means *unknown*, never 0 W.
- **House load**: DC system power minus motor (`electrical.venus.dcPower`), else
  the battery balance `solar − battery − motor`, else a configured constant.
- **Solar budget**: `solar − house load + SoC bias`, smoothed (30 s) and clamped
  to `[0, max motor power]`.
- **Match state**: `matched`, `over`, `under` (tolerance max(50 W, 10 %)), or
  `unknown` when the motor is not in drive or data is missing.
- **Target RPM**: from a propeller model `P = k · rpmⁿ` that it learns while
  you motor at steady speeds.

## Published paths

All on the self vessel, in SI units with `meta.units`:

| Path | Units |
|------|-------|
| `plugin.solarsailing.solarPower` | W |
| `plugin.solarsailing.houseLoad` | W |
| `plugin.solarsailing.socBias` | W |
| `plugin.solarsailing.budget` | W |
| `plugin.solarsailing.motorPower` | W |
| `plugin.solarsailing.balance` | W |
| `plugin.solarsailing.matchState` | `matched` / `over` / `under` / `unknown` |
| `plugin.solarsailing.targetRevolutions` | Hz |
| `plugin.solarsailing.targetShaftRevolutions` | Hz (only with a gear ratio) |
| `plugin.solarsailing.solarEnergyToday` | J |
| `plugin.solarsailing.motorEnergyToday` | J |

Notification `notifications.solarsailing.overBudget` (`warn`) when the motor
stays over budget for 60 s while in drive.

A status snapshot with a per-source breakdown is readable at
`/signalk/v2/api/resources/solar-sailing/status`.

## Configuration

Everything has a default; the settings you are most likely to change:

- **Propulsion path**: default `propulsion.main`. The venus plugin publishes a
  Curtis controller as `propulsion.99`, so set that here (or map it to `main`).
- **Gear ratio**: set `<propulsion path>.transmission.gearRatio` (motor turns
  per shaft turn) in the server's `baseDeltas.json` to also get target shaft RPM.
- **Battery bank id** and **invert battery power sign**.
- **Max motor power**: clamps the budget.
- **Path overrides** for solar, motor power and battery on non-Victron boats.
- **Reset learned propeller** after a prop change.

## Development

```sh
npm install
npm test
npm run lint
npm run typecheck
```

Design documents: [SPEC](docs/SPEC.md), [ARCHITECTURE](docs/ARCHITECTURE.md),
[build plans](docs/plans/00-roadmap.md).

## Licence

[EUPL-1.2](LICENSE)
