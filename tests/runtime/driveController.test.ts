import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BumpSource,
  CandidateDecision,
  DEFAULT_SETTINGS,
  DetectionQuality,
  DriveServiceState,
  LocationQuality,
  RoadEventType,
  createId,
  type AppSettings,
  type CandidateEvent,
  type DriveSession,
  type EncounterSummary,
  type GeoPoint,
  type LocationTrackPoint,
  type SpeedBump
} from '../../src/core/models';
import type { LocationListener, LocationPermissionStatus } from '../../src/platform/location';
import type { MotionFrame, MotionListener, MotionPermissionStatus } from '../../src/platform/motion';
import {
  DriveController,
  type BumpStore,
  type DriveStore,
  type LocationSource,
  type MotionSource,
  type WakeLockManager,
  type WarningOutput
} from '../../src/runtime/driveController';

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

function point(overrides: Partial<GeoPoint> = {}): GeoPoint {
  return {
    latitude: 30,
    longitude: 40,
    accuracyMetres: 8,
    bearingDegrees: 0,
    speedMetresPerSecond: 10,
    elapsedRealtimeNanos: 1_000_000_000,
    epochMillis: Date.now(),
    speedAccuracyMetresPerSecond: Number.NaN,
    ...overrides
  };
}

function session(now = Date.now()): DriveSession {
  return {
    id: createId(),
    startedAt: now,
    endedAt: null,
    durationMillis: 0,
    distanceMetres: 0,
    maximumSpeedMetresPerSecond: 0,
    averageSpeedMetresPerSecond: 0,
    candidateCount: 0,
    confirmedCount: 0,
    rejectedCount: 0,
    knownBumpPasses: 0,
    warningCount: 0,
    startLatitude: null,
    startLongitude: null,
    endLatitude: null,
    endLongitude: null,
    incomplete: true,
    placementProfile: 'automatic',
    vehicleProfile: null,
    algorithmVersion: 2,
    serviceInterruptions: 0,
    detectionQuality: DetectionQuality.REDUCED
  };
}

function candidate(driveId: string | null, location: GeoPoint | null): CandidateEvent {
  return {
    id: createId(),
    driveId,
    detectedAt: Date.now(),
    eventElapsedRealtimeNanos: location?.elapsedRealtimeNanos ?? 0,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    horizontalAccuracyMetres: location?.accuracyMetres ?? null,
    coordinateConfidence: 0.8,
    speedMetresPerSecond: location?.speedMetresPerSecond ?? 0,
    bearingDegrees: location?.bearingDegrees ?? null,
    confidence: 1,
    eventType: RoadEventType.LIKELY_SPEED_BUMP,
    decision: CandidateDecision.PENDING,
    confidenceReasons: ['MANUALLY_MARKED'],
    positiveVerticalPeak: 0,
    negativeVerticalPeak: 0,
    peakToPeak: 0,
    peakGapMillis: 0,
    verticalRms: 0,
    jerkPeak: 0,
    gyroscopeEnergy: 0,
    orientationVariance: 0,
    phoneStability: 1,
    source: BumpSource.MANUAL,
    note: ''
  };
}

class FakeMotion implements MotionSource {
  available = true;
  permission: MotionPermissionStatus = 'granted';
  startResult = true;
  listener: MotionListener | null = null;
  starts = 0;
  stops = 0;
  permissionRequest: (() => Promise<MotionPermissionStatus>) | null = null;

  constructor(private readonly order: string[]) {}

  requestPermission(): Promise<MotionPermissionStatus> {
    this.order.push('motion.permission');
    return this.permissionRequest?.() ?? Promise.resolve(this.permission);
  }

  start(listener: MotionListener): boolean {
    this.order.push('motion.start');
    this.starts += 1;
    if (this.startResult) this.listener = listener;
    return this.startResult;
  }

  stop(): void {
    this.order.push('motion.stop');
    this.stops += 1;
    this.listener = null;
  }

  emit(frame: MotionFrame): void {
    this.listener?.onMotion(frame);
  }
}

class FakeLocation implements LocationSource {
  available = true;
  permission: LocationPermissionStatus = 'granted';
  startResult = true;
  listener: LocationListener | null = null;
  starts = 0;
  stops = 0;

  constructor(private readonly order: string[]) {}

  requestPermission(): Promise<LocationPermissionStatus> {
    this.order.push('location.permission');
    return Promise.resolve(this.permission);
  }

  start(listener: LocationListener): boolean {
    this.order.push('location.start');
    this.starts += 1;
    if (this.startResult) this.listener = listener;
    return this.startResult;
  }

  stop(): void {
    this.order.push('location.stop');
    this.stops += 1;
    this.listener = null;
  }

  emit(location: GeoPoint, quality = LocationQuality.GOOD): void {
    this.listener?.onLocation(location, quality);
  }

  emitError(message: string): void {
    this.listener?.onError(message);
  }
}

class FakeAudio implements WarningOutput {
  releases = 0;
  resumes = 0;
  announcements: string[] = [];
  warnings: number[] = [];

  constructor(private readonly order: string[]) {}

  prime(): boolean {
    this.order.push('audio.prime');
    return true;
  }

  unlock(): Promise<boolean> {
    this.order.push('audio.unlock');
    return Promise.resolve(true);
  }

  resume(): Promise<void> {
    this.order.push('audio.resume');
    this.resumes += 1;
    return Promise.resolve();
  }

  warnSpeedBump(distanceMetres: number): void {
    this.warnings.push(distanceMetres);
  }

  announce(text: string): void {
    this.announcements.push(text);
  }

  release(): void {
    this.order.push('audio.release');
    this.releases += 1;
  }
}

class FakeWakeLock implements WakeLockManager {
  acquisitions = 0;
  releases = 0;

  constructor(private readonly order: string[]) {}

  acquire(): Promise<boolean> {
    this.order.push('wake.acquire');
    this.acquisitions += 1;
    return Promise.resolve(true);
  }

  release(): Promise<void> {
    this.order.push('wake.release');
    this.releases += 1;
    return Promise.resolve();
  }
}

class FakeBumps implements BumpStore {
  saved: CandidateEvent[] = [];
  encounters: EncounterSummary[] = [];
  warningsUpdated: Array<{ id: string; timestamp: number }> = [];
  query: (location: GeoPoint, radius: number) => Promise<SpeedBump[]> = () => Promise.resolve([]);

  createManualCandidate(
    driveId: string | null,
    location: GeoPoint | null
  ): Promise<CandidateEvent> {
    const created = candidate(driveId, location);
    this.saved.push(created);
    return Promise.resolve(created);
  }

  saveCandidate(value: CandidateEvent): Promise<void> {
    this.saved.push(value);
    return Promise.resolve();
  }

  queryWarningCandidates(location: GeoPoint, radius: number): Promise<SpeedBump[]> {
    return this.query(location, radius);
  }

  updateLastWarned(id: string, timestamp: number): Promise<void> {
    this.warningsUpdated.push({ id, timestamp });
    return Promise.resolve();
  }

  recordEncounter(value: EncounterSummary): Promise<void> {
    this.encounters.push(value);
    return Promise.resolve();
  }
}

class FakeDrives implements DriveStore {
  current: DriveSession | null = null;
  updates: DriveSession[] = [];
  finishes: DriveSession[] = [];
  tracks: LocationTrackPoint[][] = [];

  constructor(private readonly order: string[]) {}

  startDrive(
    _quality?: DetectionQuality,
    _start?: GeoPoint | null,
    now = Date.now()
  ): Promise<DriveSession> {
    this.order.push('drive.start');
    this.current = session(now);
    return Promise.resolve(this.current);
  }

  updateDrive(value: DriveSession): Promise<void> {
    this.updates.push(value);
    this.current = value;
    return Promise.resolve();
  }

  finishDrive(value: DriveSession): Promise<void> {
    const finished = { ...value, incomplete: false };
    this.finishes.push(finished);
    this.current = finished;
    return Promise.resolve();
  }

  recordTrackPoints(values: readonly LocationTrackPoint[]): Promise<void> {
    this.tracks.push([...values]);
    return Promise.resolve();
  }
}

interface Harness {
  controller: DriveController;
  order: string[];
  motion: FakeMotion;
  location: FakeLocation;
  audio: FakeAudio;
  wake: FakeWakeLock;
  bumps: FakeBumps;
  drives: FakeDrives;
}

const controllers: DriveController[] = [];

function harness(settings: AppSettings = DEFAULT_SETTINGS): Harness {
  const order: string[] = [];
  const motion = new FakeMotion(order);
  const location = new FakeLocation(order);
  const audio = new FakeAudio(order);
  const wake = new FakeWakeLock(order);
  const bumps = new FakeBumps();
  const drives = new FakeDrives(order);
  const controller = new DriveController(settings, { motion, location, audio, wakeLock: wake, bumps, drives });
  controllers.push(controller);
  return { controller, order, motion, location, audio, wake, bumps, drives };
}

afterEach(async () => {
  setVisibility('visible');
  await Promise.all(controllers.splice(0).map((controller) => controller.dispose()));
  vi.restoreAllMocks();
});

describe('DriveController Start Drive flow', () => {
  it('runs the iOS-safe permission and activation sequence before enabling detection', async () => {
    setVisibility('visible');
    const app = harness();
    await app.controller.start();

    expect(app.order.slice(0, 8)).toEqual([
      'audio.prime',
      'motion.permission',
      'location.permission',
      'audio.unlock',
      'wake.acquire',
      'drive.start',
      'motion.start',
      'location.start'
    ]);
    expect(app.controller.getSnapshot()).toMatchObject({
      serviceState: DriveServiceState.ACTIVE,
      detectionQuality: DetectionQuality.REDUCED,
      foregroundRequired: false
    });
  });

  it.each([
    ['motion denied', 'denied', 'granted'],
    ['motion unavailable', 'unavailable', 'granted'],
    ['location denied', 'granted', 'denied'],
    ['location unavailable', 'granted', 'unavailable']
  ] as const)('fails cleanly when %s', async (_label, motionPermission, locationPermission) => {
    setVisibility('visible');
    const app = harness();
    app.motion.permission = motionPermission;
    app.location.permission = locationPermission;

    await expect(app.controller.start()).rejects.toThrow();
    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.FAILED);
    expect(app.controller.getSnapshot().errorMessage).toBeTruthy();
    expect(app.audio.releases).toBe(1);
    expect(app.motion.listener).toBeNull();
    expect(app.location.listener).toBeNull();
    expect(app.drives.current).toBeNull();
  });

  it('aborts permission startup if the page becomes hidden', async () => {
    setVisibility('visible');
    const app = harness();
    let resolvePermission: ((status: MotionPermissionStatus) => void) | null = null;
    app.motion.permissionRequest = () => new Promise((resolve) => { resolvePermission = resolve; });

    const starting = app.controller.start();
    await vi.waitFor(() => expect(resolvePermission).not.toBeNull());
    setVisibility('hidden');
    resolvePermission!('granted');

    await expect(starting).rejects.toThrow('Keep BumpCompanion open');
    expect(app.order).not.toContain('location.permission');
    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.FAILED);
  });

  it('closes an incomplete session if either sensor cannot actually start', async () => {
    setVisibility('visible');
    const app = harness();
    app.location.startResult = false;

    await expect(app.controller.start()).rejects.toThrow('required sensors');
    expect(app.drives.updates).toHaveLength(1);
    expect(app.drives.updates[0]).toMatchObject({ incomplete: true });
    expect(app.audio.releases).toBe(1);
    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.FAILED);
  });
});

describe('DriveController foreground lifecycle', () => {
  it('pauses immediately when hidden, rejects hidden samples, and safely resumes on return', async () => {
    setVisibility('visible');
    const app = harness();
    await app.controller.start();
    app.location.emit(point());
    await vi.waitFor(() => expect(app.controller.getSnapshot().lastLocation).not.toBeNull());

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(app.controller.getSnapshot()).toMatchObject({
      serviceState: DriveServiceState.BACKGROUND_PAUSED,
      foregroundRequired: true,
      currentSpeedMetresPerSecond: null
    });
    const snapshot = app.controller.getSnapshot();
    app.location.emit(point({ latitude: 31, elapsedRealtimeNanos: 2_000_000_000 }));
    expect(app.controller.getSnapshot()).toEqual(snapshot);
    await vi.waitFor(() => expect(app.wake.releases).toBeGreaterThan(0));

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => {
      expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.ACTIVE);
    });
    expect(app.motion.starts).toBe(2);
    expect(app.location.starts).toBe(2);
    expect(app.wake.acquisitions).toBe(2);
    expect(app.controller.getSnapshot().errorMessage).toBeNull();
  });

  it('does not auto-resume a drive the user paused deliberately', async () => {
    setVisibility('visible');
    const app = harness();
    await app.controller.start();
    await app.controller.pause();
    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.PAUSED);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.PAUSED);
    expect(app.motion.starts).toBe(1);

    // A late provider callback must not accidentally convert PAUSED into GPS_DEGRADED.
    app.controller.onError('Location is temporarily unavailable.');
    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.PAUSED);
  });

  it('treats pagehide as a suspension even before visibility changes', async () => {
    setVisibility('visible');
    const app = harness();
    await app.controller.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.BACKGROUND_PAUSED);
  });

  it('degrades on temporary GPS errors, recovers on a trusted fix, and stops on permission loss', async () => {
    setVisibility('visible');
    const app = harness();
    await app.controller.start();
    app.location.emitError('Location is temporarily unavailable.');
    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.GPS_DEGRADED);

    app.location.emit(point(), LocationQuality.GOOD);
    await vi.waitFor(() => expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.ACTIVE));
    app.location.emitError('Location permission is missing. Drive Mode has stopped.');
    await vi.waitFor(() => expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.FAILED));
    expect(app.drives.updates.at(-1)).toMatchObject({ incomplete: true });
    expect(app.audio.releases).toBe(1);
  });
});

describe('DriveController persistence and shutdown', () => {
  it('waits for queued location work before cleanly ending the session', async () => {
    setVisibility('visible');
    const app = harness();
    let resolveQuery: ((bumps: SpeedBump[]) => void) | null = null;
    app.bumps.query = () => new Promise((resolve) => { resolveQuery = resolve; });
    await app.controller.start();
    app.location.emit(point());
    await vi.waitFor(() => expect(resolveQuery).not.toBeNull());

    const ending = app.controller.end();
    await Promise.resolve();
    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.STOPPING);
    expect(app.drives.finishes).toHaveLength(0);
    resolveQuery!([]);
    await ending;

    expect(app.drives.finishes).toHaveLength(1);
    expect(app.drives.finishes[0]).toMatchObject({ incomplete: false });
    expect(app.controller.getSnapshot().serviceState).toBe(DriveServiceState.IDLE);
    expect(app.audio.releases).toBe(1);
  });

  it('flushes opt-in route points and final drive statistics before clearing runtime state', async () => {
    setVisibility('visible');
    const app = harness({ ...DEFAULT_SETTINGS, routeHistoryEnabled: true });
    await app.controller.start();
    app.location.emit(point());
    await vi.waitFor(() => expect(app.controller.getSnapshot().lastLocation).not.toBeNull());
    app.location.emit(point({
      latitude: 30.0002,
      elapsedRealtimeNanos: 4_000_000_000,
      epochMillis: Date.now() + 3_000,
      speedMetresPerSecond: 12
    }));
    await vi.waitFor(() => expect(app.controller.getSnapshot().distanceMetres).toBeGreaterThan(10));

    await app.controller.end();

    expect(app.drives.tracks.flat()).toHaveLength(2);
    expect(app.drives.finishes[0].distanceMetres).toBeGreaterThan(10);
    expect(app.drives.finishes[0]).toMatchObject({
      endLatitude: 30.0002,
      maximumSpeedMetresPerSecond: 12,
      incomplete: false
    });
  });

  it('serializes duplicate End Drive actions into one persisted completion', async () => {
    setVisibility('visible');
    const app = harness();
    await app.controller.start();
    await Promise.all([app.controller.end(), app.controller.end()]);
    expect(app.drives.finishes).toHaveLength(1);
    expect(app.audio.releases).toBe(1);
  });

  it('cannot be started again after disposal', async () => {
    setVisibility('visible');
    const app = harness();
    await app.controller.dispose();
    await expect(app.controller.start()).rejects.toThrow('no longer available');
  });
});
