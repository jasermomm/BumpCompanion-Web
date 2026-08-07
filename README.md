# BumpCompanion Web

[![CI](https://github.com/jasermomm/BumpCompanion-Web/actions/workflows/ci.yml/badge.svg)](https://github.com/jasermomm/BumpCompanion-Web/actions/workflows/ci.yml)
[![Pages](https://github.com/jasermomm/BumpCompanion-Web/actions/workflows/pages.yml/badge.svg)](https://github.com/jasermomm/BumpCompanion-Web/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

BumpCompanion Web is the iPhone-focused Progressive Web App edition of BumpCompanion. It uses phone motion, GPS context, and a structured road-event detector to identify possible speed bumps for later review and warn when you approach saved bumps again.

The app is local-first: there is no account, backend, advertising, analytics, or automatic upload. Core detection works without a network connection after the application shell is cached. Map tiles require connectivity unless the browser already has them cached.

Live app: **https://jasermomm.github.io/BumpCompanion-Web/**

> BumpCompanion may miss bumps or give incorrect warnings. Always watch the road and drive safely. Do not interact with the app while driving.

## Install on iPhone

1. Open the live website in **Safari**.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Launch **BumpCompanion** from the Home Screen.
5. Press **Start Drive**.
6. Allow Motion and Location access when prompted.

Safari does not provide the same automatic install prompt used by many Android browsers.

## Use Drive Mode

Secure the iPhone in a stable vehicle mount and keep BumpCompanion visible. Start Drive requests motion access from the required user gesture, then location access, initializes warning audio, requests a screen wake lock where available, and starts the sensor pipeline.

During a drive, BumpCompanion can:

- analyze complete timestamped motion events rather than individual acceleration spikes;
- save accepted detections as reviewable candidates;
- show nearby saved bumps on an OpenStreetMap map;
- warn about compatible saved bumps ahead;
- record drive summary statistics and, when enabled, a sparse local route history;
- let the passenger mark a bump manually, pause, mute, or end the session.

Review detections after parking. A detection is never silently published or shared.

## Important iOS limitation

iOS Safari and installed web apps cannot reliably continue motion/GPS processing after the page is hidden, the phone is locked, or the operating system suspends it. BumpCompanion must remain open and visible during Drive Mode.

When the page becomes hidden, the app stops trusting motion timing and resets detector history. When it becomes visible again, it restores the active screen, safely restarts the foreground pipeline, and attempts to reacquire the screen wake lock. A service worker cannot collect motion or location in the background.

Desktop Chromium and WebKit automation validates application behavior, but it is not equivalent to physical-iPhone sensor validation. Vehicle, mount, Safari version, sample timing, and device axes can all affect real-world performance.

## Detector

The TypeScript detector is a direct port of the final Android detector-v2 domain logic. It retains:

- real-timestamp filtering and gap handling;
- median deglitching, gravity/drift removal, multiple signal bands, jerk, and envelope processing;
- bounded rolling history and an asymmetric adaptive vibration baseline;
- complete capture/settle/evaluate state transitions;
- seven bump waveform profiles;
- approach braking and post-event acceleration context;
- explicit pothole, rough-road, turn, hill/ramp, phone-motion, stationary, clipping, and high-frequency rejection;
- axle grouping, consecutive-event handling, and sensitivity presets;
- event/location timestamp alignment and a trajectory-aware saved-bump approach predictor.

Accepted events remain local candidates until a person reviews them. The detector is deterministic and replayable, but no deterministic phone IMU classifier can guarantee road-feature identity.

See [Android-to-web mapping](docs/ANDROID_WEB_MAPPING.md) and [architecture](docs/ARCHITECTURE.md).

## Privacy and offline behavior

Settings, bumps, candidates, drive summaries, calibration data, encounters, and optional route points are stored in IndexedDB for this origin. Nothing is sent to a BumpCompanion server because no server exists. User-triggered export creates a `.bumpcompanion` JSON file with an integrity checksum.

The service worker precaches only the static application shell. It does not cache private IndexedDB data, exports, sensor streams, route history, or map tiles. The map uses OpenStreetMap tiles with attribution; requesting a tile necessarily contacts the tile provider and may reveal the requesting IP address and viewed region. Opening a saved location in Apple Maps is an explicit user action and sends that coordinate to Apple.

Read the full [privacy notice](PRIVACY.md).

## Development

Requirements: Node.js 20.19 or newer and npm.

```bash
npm install
npm run dev
```

Release checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

`src/testing` and detector replay helpers are test/development infrastructure. They are not imported by the production UI and are tree-shaken from the release bundle.

## Deployment

Pushes to `main` are verified by CI and deployed automatically to GitHub Pages through the official Pages Actions workflow. Vite's base path, manifest start URL, service-worker scope, and cached asset URLs are built for the repository subpath.

## Contributing

Contributions are welcome. Detector changes require regression coverage and a clear account of expected false-positive/false-negative tradeoffs. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

MIT © 2026 Jaser Mohamed. See [LICENSE](LICENSE).
