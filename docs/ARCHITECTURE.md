# Architecture

```text
DeviceMotion / DeviceOrientation      navigator.geolocation
                |                              |
                v                              v
       browser motion normalization     trusted-fix validation
                |                              |
                +------------+-----------------+
                             v
              timestamped detector-v2 core
                             |
                accepted review candidate
                             |
                             v
   React UI <---------- Drive controller ----------> warning output
      |                       |                           |
      +------------------- IndexedDB              Speech/Web Audio
      |
 Leaflet + OSM (optional network tiles)
```

The detector, geometry, approach predictor, and event-location estimator are framework-independent TypeScript. Browser APIs are isolated behind motion, location, audio, and wake-lock adapters. IndexedDB repositories own durable records. React owns presentation and calls a foreground drive controller; the UI never classifies raw samples itself.

## Lifecycle

```text
Idle → Preparing → Active ⇄ Paused → Stopping → Idle
                       |
                       └→ hidden/suspended → Background paused
                                              |
                                              └→ visible → reset + restart
```

Start Drive is the permission-bearing gesture. The app unlocks audio in the gesture task, requests iOS motion permission, requests geolocation, attempts a screen wake lock, and begins listeners. When hidden, motion and location listeners stop, detector/location histories reset, and the app records an interruption. Visibility restoration restarts a clean foreground pipeline and reacquires the wake lock where possible.

The service worker precaches only compiled application assets. It cannot access `DeviceMotionEvent`, geolocation, or IndexedDB drive control while the application is suspended.

## Persistence

IndexedDB schema v3 contains settings, speed bumps, candidate events, drive sessions, encounters, optional route points, calibration profiles, import batches/items, and metadata. Migrations are explicit and tested. Private structured data is never stored in Cache Storage.

## Production and test separation

Replay and synthetic scenario helpers call the same detector core used by Drive Mode. They live under `src/testing`, have no production route or UI import, and are omitted from the production bundle through tree shaking.
