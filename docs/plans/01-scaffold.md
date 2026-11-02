# Implementation Plan: Scaffold

## Overview
An installable, empty plugin with the tooling every later plan relies on.

## Relevant SPEC/ARCHITECTURE Sections
- ARCHITECTURE 4 (stack), 7 (file structure), 8 (deployment)
- SPEC 11 (EUPL-1.2, ESM, zero runtime deps)

## Approach
ES module package (`"type": "module"`), default-exported plugin factory with
an empty `start`/`stop` and the full config schema from SPEC 8 as a plain
JSON-schema object in `lib/config.js`. Tooling is dev-only.

## Test Strategy
`node:test` smoke test: the factory returns an object with `id`, `name`,
`schema`, `start`, `stop`; `start` and `stop` run against a fake `app`.
Schema defaults match SPEC 8.

## Implementation Steps
- [ ] `package.json`: name `signalk-solar-sailing`, `type: module`, `main:
      index.js`, `files` (`index.js`, `lib`, `public`), keywords
      `signalk-node-server-plugin`, `signalk-webapp`, `signalk-category-utility`,
      `signalk.appIcon: public/icon.png`, `engines.node >= 18`, licence `EUPL-1.2`
- [ ] `LICENSE` (EUPL-1.2 text), `.gitignore`, short `README.md`
- [ ] `lib/config.js`: schema + defaults + path validation (`^[A-Za-z0-9_.]+$`),
      including Propulsion path (`propulsion.main`) and idle threshold (15 W)
- [ ] `lib/types.js`: JSDoc typedefs from ARCHITECTURE 3
- [ ] `index.js`: factory, empty tick, `try/catch` scaffolding
- [ ] Dev tooling: `typescript` (`tsc --noEmit --checkJs`), ESLint with
      `ecmaVersion: 2017` override for `public/`, scripts `test`, `lint`,
      `typecheck`
- [ ] `.github/workflows/test.yml`: Node 18 and 22, lint + typecheck + test
- [ ] Move the draft from `/mnt/project-files/solar-sailing/draft-lib/` into
      `lib/` converted to ESM (no behaviour changes yet)

## Files to Create/Modify
`package.json`, `LICENSE`, `README.md`, `.gitignore`, `index.js`,
`lib/config.js`, `lib/types.js`, `lib/power.js`, `lib/matcher.js`,
`lib/energy.js`, `test/plugin.test.js`, `tsconfig.json`, `eslint.config.js`,
`.github/workflows/test.yml`
