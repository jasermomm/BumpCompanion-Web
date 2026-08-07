# Android → iOS Web Feature Mapping

This mapping was produced by tracing the complete Android source before implementation. `Direct` means the domain behavior and consumer presentation are preserved. `Adapted` means the same goal is implemented through web APIs or iOS-specific interaction. `Impossible` identifies a platform capability that a static PWA cannot honestly reproduce.

| Android reference | Web/PWA implementation | Status |
|---|---|---|
| Four-page onboarding, safety, privacy | IndexedDB-backed onboarding with the same concepts, safe-area layout, and honest iOS foreground wording | Direct + adapted wording |
| Home/Bumps/Drives/Settings bottom navigation | Fixed four-tab React shell; Review and Calibration drill-downs hide tabs | Direct |
| Material fallback amber palettes, light/dark modes, shapes | Exact fallback colors, system/light/dark CSS themes, iOS system typography | Direct |
| Android dynamic wallpaper colors | Stable branded palette; browsers cannot read iOS wallpaper colors | Impossible / adapted |
| Android launcher artwork | Original composite icon derived into Apple touch, 192, 512, and maskable PNGs | Direct |
| Idle and active Drive Mode UI | Status, speed, duration, distance, placement, passes, next bump, pause, mark, mute, End Drive | Direct |
| Android runtime permissions | Mount/safety sheet then gesture-bound motion request and geolocation request | Adapted |
| Foreground service and actionable persistent notification | Foreground page controller and visible controls | Impossible / adapted |
| Background/locked motion and GPS | Detection pauses and history resets whenever the app is hidden or suspended | Impossible |
| Android process `START_STICKY` recovery | Persist an interrupted session marker; never claim continued collection | Impossible / adapted |
| No Android wake lock | Screen Wake Lock requested while an active web session is visible | Web addition |
| Android accelerometer, gyro, gravity, rotation vector | DeviceMotion/DeviceOrientation normalization, gravity fallback, degree/radian conversion | Adapted |
| Requested fixed sensor rates/batching | Real callback timestamps and gap handling; Safari controls callback rate | Impossible / adapted |
| Detector-v2 signal processing and state machine | TypeScript port of constants, filters, baseline, windows, profiles, scoring, rejection, grouping | Direct |
| GPS speed/location quality and event alignment | `watchPosition`, stronger invalid-jump checks, asynchronous trusted fix history, interpolation/projection | Direct + required adaptation |
| Candidate-first review model | Every accepted event remains pending until confirmed; no automatic publication | Direct |
| Bump list/search/filter/edit/archive/remove/delete | IndexedDB-backed consumer UI | Direct |
| External map/navigation intents | Apple Maps web links and touch-friendly actions | Adapted |
| No embedded Android map | Leaflet + attributed OpenStreetMap tiles with saved/current markers | New user requirement |
| Approach predictor and warning phases | Direct geometry/trajectory port using accepted fixes and saved bumps | Direct |
| Android TTS, tone, vibration | Speech Synthesis, unlocked Web Audio tone, optional capability-aware vibration | Adapted |
| Android audio focus/ducking and iPhone vibration | No reliable web equivalent | Impossible |
| Room v3 structured storage | IndexedDB v3 stores and explicit migrations | Adapted |
| DataStore preferences | IndexedDB settings record | Adapted |
| `.bumpcompanion` schema-1 import/export | File input, preview, validation, SHA-256, Blob download/Web Share | Direct + adapted I/O |
| Local drive history and optional two-second route points | IndexedDB drive summaries and opt-in route points | Direct |
| Five-second stationary calibration | Motion-permission-aware foreground browser calibration | Adapted |
| Release-only diagnostic exclusion | Replay/diagnostics remain test-only with no production route or visible controls | Direct |
| Android offline local processing | Precached PWA shell, local detector and IndexedDB; map tiles may be unavailable | Adapted |
| No analytics/accounts/backend | No trackers, accounts, ads, or application backend | Direct |

## Detector parity notes

The final Android production detector is `HeuristicRoadEventDetector` version 2. The web port retains its 0.20–5.2 Hz event band, 1.35 Hz broad band, above-9 Hz residual, 2.2 Hz envelope, adaptive baseline, 320 ms quiet period, 430 ms settling context, 4.8 s capture bound, 260 ms event guard, seven profile families, evidence weights, false-positive penalties, physical gates, sensitivity presets, recent-motion memory, and event-aware grouping.

Browser normalization is necessarily adapted because Safari does not expose Android rotation vectors, requested sampling/batching, a foreground sensor service, or stable locked-screen callbacks. The detector core itself remains timestamp-based and does not assume a fixed callback interval.
