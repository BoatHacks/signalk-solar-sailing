# Implementation Plan: Release

## Overview
First public release on npm and in the Signal K app store.

## Relevant SPEC/ARCHITECTURE Sections
- ARCHITECTURE 4 (publish), 8 (deployment)
- SPEC 6.3 (app icon)
- Skills: plugin-release, npm-oidc-publish, signalk-registry, signalk-visuals 13

## Approach
Follow the plugin-release skill; npm trusted publishing (OIDC) from a GitHub
release, with the first publish done once by hand as that skill describes.

## Notes
The icon was made by Tobi with an image model (a squirrel next to a scale
weighing the sun against a propeller) and resized to 512 px.
The remaining steps (first manual publish, trusted publisher, repo metadata,
tag, registry score) need Tobi's npm and GitHub accounts.

## Test Strategy
- `npm pack --dry-run` lists only `index.js`, `lib/`, `public/`,
  `docs/screenshots/`, `LICENSE`, `README.md`, `CHANGELOG.md`, `package.json`
- install the packed tarball on a development server; plugin starts, webapp
  loads, icon shows in the app list
- signalk-registry score check after publishing

## Implementation Steps
- [x] App icon: squirrel and a scale weighing sun against propeller, flat
      gold and white on navy, 512 px PNG at `public/icon.png`
- [x] README: what it does, requirements (server ≥ 2.14, venus plugin with
      PR #210, a History API provider), config, paths, screenshots, the
      `propulsion.main` vs `propulsion.99` note
- [x] `CHANGELOG.md`
- [x] `.github/workflows/publish.yml` (OIDC)
- [ ] First manual publish, then trusted-publisher setup
- [ ] Before tagging: registry checks 1–8 from the signalk-registry skill
      pass locally (screenshots resolve and are in `files`, CHANGELOG entry
      for the version, `npm audit --omit=dev` clean, plugin-CI pin is the
      latest signalk-server release, version not yet on npm, displayName and
      recommends set and matching the README)
- [ ] GitHub repo metadata: description, homepage
      `https://www.npmjs.com/package/signalk-solar-sailing`, topics `signalk`,
      `signalk-plugin`, `marine`, `solar`, `electric-propulsion`
- [ ] After the next nightly: published score at
      `https://signalk.org/signalk-plugin-registry/plugins/signalk-solar-sailing.json`
      is 100; fix and re-release if not

## Files to Create/Modify
`public/icon.png`, `README.md`, `CHANGELOG.md`,
`.github/workflows/publish.yml`, `package.json`
