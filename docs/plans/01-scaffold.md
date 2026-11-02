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
Schema defaults match SPEC 8, and the schema is valid JSON Schema.

## Implementation Steps
- [ ] `package.json`: name `signalk-solar-sailing`, `type: module`, `main:
      index.js`, `files` (`index.js`, `lib`, `public`), keywords
      `signalk-node-server-plugin`, `signalk-webapp`, `signalk-category-utility`,
      `signalk-category-electrical`, `engines.node >= 22`, licence `EUPL-1.2`,
      and the `signalk` block from ARCHITECTURE 8 (`displayName`, `appIcon`,
      `screenshots`, `recommends`); `files` includes `docs/screenshots/`
- [ ] `LICENSE` (EUPL-1.2 text), `.gitignore`, short `README.md`
- [ ] `lib/config.js`: schema + defaults + path validation (`^[A-Za-z0-9_.]+$`),
      including Propulsion path (`propulsion.main`) and idle threshold (15 W)
- [ ] `lib/types.js`: JSDoc typedefs from ARCHITECTURE 3
- [ ] `index.js`: factory, empty tick, `try/catch` scaffolding
- [ ] Dev tooling: `typescript` (`tsc --noEmit --checkJs`), ESLint with
      `ecmaVersion: 2017` override for `public/`, scripts `test`, `lint`,
      `typecheck`
- [ ] `.github/workflows/test.yml`: Node 22 and 24, lint + typecheck + test
- [ ] `.github/workflows/plugin-ci.yml`: reusable Signal K workflow pinned to
      `1bf8c461ca47a735fc3e8d4a1c4e8f20614aa9fd` (v2.35.1, or the latest
      release SHA at the time), `enable-signalk-integration: true`
- [ ] `package-lock.json` committed (`npm i --package-lock-only`); `npm audit
      --omit=dev` clean
- [ ] `CHANGELOG.md` with an `Unreleased` section
- [ ] Move the draft from `/mnt/project-files/solar-sailing/draft-lib/` into
      `lib/` converted to ESM (no behaviour changes yet)

## Files to Create/Modify
`package.json`, `LICENSE`, `README.md`, `.gitignore`, `index.js`,
`lib/config.js`, `lib/types.js`, `lib/power.js`, `lib/matcher.js`,
`lib/energy.js`, `test/plugin.test.js`, `tsconfig.json`, `eslint.config.js`,
`.github/workflows/test.yml`, `.github/workflows/plugin-ci.yml`,
`package-lock.json`, `CHANGELOG.md`
