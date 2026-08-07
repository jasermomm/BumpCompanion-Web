# Contributing to BumpCompanion Web

Thank you for helping improve BumpCompanion.

## Workflow

1. Fork the repository and create a focused branch from `main`.
2. Install dependencies with `npm install`.
3. Make focused TypeScript, React, CSS, or test changes.
4. Run `npm run check` and the relevant Playwright projects.
5. Open a pull request that explains the behavior, motivation, user impact, and validation.

Never commit credentials, personal location history, `.bumpcompanion` exports, private sensor recordings, or browser databases. Update documentation when permissions, data handling, the exchange schema, detector behavior, or browser limitations change.

## Detector changes

Detection is sensitive to filtering, timestamps, sampling gaps, thresholds, profiles, and event grouping. A detector pull request must describe:

- the physical behavior being changed;
- the intended false-positive or false-negative improvement;
- devices, mounts, vehicles, recordings, fixtures, or synthetic scenarios used;
- whether Android parity is intentionally changed; and
- known tradeoffs and remaining uncertainty.

Add or update deterministic replay tests. Synthetic cases are useful regression guards, but they are not a substitute for labeled physical-device validation.

## Product behavior

Keep production UI consumer-focused. Do not expose raw sensor values, confidence scores, internal state names, diagnostic graphs, replay controls, or mock-data tools. Development tools belong in test-only modules and must remain outside the production bundle and routes.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
