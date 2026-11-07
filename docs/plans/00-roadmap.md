# Roadmap

MVP (SPEC 9.1) in build order. Each plan is small enough for one PR.

| # | Plan | Delivers | Depends on | Status |
|---|------|----------|------------|--------|
| 1 | [Scaffold](01-scaffold.md) | package, lint, typecheck, CI, licence | – | done |
| 2 | [Sources](02-sources.md) | data tree → readings, discovery, staleness | 1 | done |
| 3 | [Engine](03-engine.md) | snapshot: house load, SoC bias, budget, match state | 2 | done |
| 4 | [Propeller model](04-propeller.md) | learned `k`, `n`, target RPM | 3 | done |
| 5 | [Energy today](05-energy.md) | counters, History API seed | 3 | done |
| 6 | [Outputs and wiring](06-outputs.md) | paths, metadata, notification, resources, `index.js` | 3–5 | done |
| 7 | [Webapp](07-webapp.md) | cockpit/plotter dashboard | 6 | todo |
| 8 | [Release](08-release.md) | icon, README, screenshots, npm publish | 7 | todo |

After 6 the plugin is usable with KIP or the data browser; 7 adds the
dashboard. Post-MVP items (SPEC 9.2) get their own plans when started.
