# Privacy Notice

BumpCompanion Web is local-first and does not have an account system, application backend, analytics, advertising, trackers, or automatic uploads.

## Data processed on this device

While Drive Mode is active and visible, the app processes motion callbacks and geolocation updates to identify possible speed-bump events, estimate event coordinates, calculate drive statistics, and warn about saved bumps ahead. Motion samples are held in bounded memory for detection and are not persistently recorded by the production app.

IndexedDB may contain:

- saved bump coordinates, labels, notes, and warning preferences;
- reviewable candidate events and limited derived event features;
- drive summaries and encounters;
- settings and calibration summaries; and
- sparse route points only when route-history recording is enabled.

Browser storage is origin-scoped but not encrypted by BumpCompanion and may be removed by the user, browser, or operating system. Delete actions clear the corresponding local records. They cannot revoke permission choices stored by Safari; those are controlled through browser/device settings.

## Network access

Core motion processing and detection do not require a network connection after the application shell is cached. The installed shell is served from GitHub Pages. Opening the map requests tiles from OpenStreetMap infrastructure; this can reveal the requesting IP address and viewed map region to the tile provider. BumpCompanion does not prefetch or separately cache map tiles for offline use. Selecting **Open in Maps** is an explicit user action that opens Apple Maps with the selected coordinate; Apple's service then receives that request under Apple's own terms and privacy policy.

Warning speech is generated through the browser's Speech Synthesis implementation. Geolocation, motion permission, speech, and other browser capabilities are provided by Safari and iOS and remain subject to the device's platform settings and privacy controls.

## Export and import

Export happens only after a user action and creates a `.bumpcompanion` file containing exportable saved bump records. It does not include motion streams, route history, drive history, candidates, browser identifiers, or secrets. Anyone who receives an export can read its exact coordinates and notes, so treat it as sensitive.

Import validates the file size, schema, fields, coordinates, duplicate identifiers, and optional SHA-256 integrity checksum before merging records. A checksum detects accidental modification; it is not authentication or encryption.

## Foreground limitation

iOS may suspend web pages after they become hidden or the phone locks. BumpCompanion stops trusting timing and resets detection state when hidden. It does not claim reliable background collection.
