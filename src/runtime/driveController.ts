import { ApproachPredictor, WarningPhase, type ApproachDecision } from '../core/approach';
import {
  EventLocationEstimator,
  HeuristicRoadEventDetector,
  detectorConfigurationForSensitivity,
  type DetectedRoadEvent
} from '../core/detector';
import { GeoMath } from '../core/geo';
import {
  BumpSource,
  CandidateDecision,
  DetectionQuality,
  DriveServiceState,
  EMPTY_RUNTIME,
  LocationQuality,
  PhonePlacementState,
  createId,
  type AppSettings,
  type CandidateEvent,
  type DriveRuntimeState,
  type DriveSession,
  type GeoPoint,
  type LocationTrackPoint
} from '../core/models';
import { BumpRepository } from '../data/bumpRepository';
import { DriveRepository } from '../data/driveRepository';
import { WarningAudio } from '../platform/audio';
import { BrowserLocationProvider, type LocationListener } from '../platform/location';
import { BrowserMotionProvider, type MotionFrame, type MotionListener } from '../platform/motion';
import { ScreenWakeLock } from '../platform/wakeLock';

type RuntimeListener = () => void;

export type MotionSource = Pick<
  BrowserMotionProvider,
  'available' | 'requestPermission' | 'start' | 'stop'
>;
export type LocationSource = Pick<
  BrowserLocationProvider,
  'available' | 'requestPermission' | 'start' | 'stop'
>;
export type WarningOutput = Pick<
  WarningAudio,
  'prime' | 'unlock' | 'resume' | 'warnSpeedBump' | 'announce' | 'release'
>;
export type WakeLockManager = Pick<ScreenWakeLock, 'acquire' | 'release'>;
export type BumpStore = Pick<
  BumpRepository,
  | 'createManualCandidate'
  | 'saveCandidate'
  | 'queryWarningCandidates'
  | 'updateLastWarned'
  | 'recordEncounter'
>;
export type DriveStore = Pick<
  DriveRepository,
  'startDrive' | 'updateDrive' | 'finishDrive' | 'recordTrackPoints'
>;

export interface DriveControllerDependencies {
  motion?: MotionSource;
  location?: LocationSource;
  audio?: WarningOutput;
  wakeLock?: WakeLockManager;
  bumps?: BumpStore;
  drives?: DriveStore;
}

export class DriveController implements MotionListener, LocationListener {
  private readonly motion: MotionSource;
  private readonly location: LocationSource;
  private readonly audio: WarningOutput;
  private readonly wakeLock: WakeLockManager;
  private readonly bumps: BumpStore;
  private readonly drives: DriveStore;
  private readonly detector = new HeuristicRoadEventDetector();
  private readonly locationEstimator = new EventLocationEstimator();
  private approach = new ApproachPredictor();
  private settings: AppSettings;
  private runtime: DriveRuntimeState = { ...EMPTY_RUNTIME };
  private session: DriveSession | null = null;
  private readonly listeners = new Set<RuntimeListener>();
  private readonly locationHistory: GeoPoint[] = [];
  private previousLocation: GeoPoint | null = null;
  private speedSum = 0;
  private speedSamples = 0;
  private maximumSpeed = 0;
  private pendingTrackPoints: LocationTrackPoint[] = [];
  private lastTrackPointNanos = 0;
  private lastSessionPersistMillis = 0;
  private processing = Promise.resolve();
  private shutdown: Promise<void> | null = null;
  private disposed = false;

  constructor(settings: AppSettings, dependencies: DriveControllerDependencies = {}) {
    this.settings = settings;
    this.motion = dependencies.motion ?? new BrowserMotionProvider();
    this.location = dependencies.location ?? new BrowserLocationProvider();
    this.audio = dependencies.audio ?? new WarningAudio();
    this.wakeLock = dependencies.wakeLock ?? new ScreenWakeLock();
    this.bumps = dependencies.bumps ?? new BumpRepository();
    this.drives = dependencies.drives ?? new DriveRepository();
    this.detector.updateConfiguration(detectorConfigurationForSensitivity(settings.sensitivity));
    this.approach = new ApproachPredictor(settings.warningCooldownSeconds * 1_000);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
  }

  getSnapshot = (): DriveRuntimeState => this.runtime;

  subscribe = (listener: RuntimeListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get detectionSupported(): boolean {
    return this.motion.available && this.location.available;
  }

  updateSettings(settings: AppSettings): void {
    const sensitivityChanged = settings.sensitivity !== this.settings.sensitivity;
    this.settings = settings;
    if (sensitivityChanged) {
      this.detector.updateConfiguration(detectorConfigurationForSensitivity(settings.sensitivity));
    }
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Drive Mode is no longer available on this page.');
    if (this.isRunning()) return;
    if (document.visibilityState !== 'visible') throw new Error('Open BumpCompanion before starting Drive Mode.');
    if (!this.detectionSupported) throw new Error('Motion or location sensors are unavailable in this browser.');

    this.setRuntime({
      ...EMPTY_RUNTIME,
      serviceState: DriveServiceState.PREPARING,
      detectionQuality: DetectionQuality.REDUCED
    });
    try {
      // Prime synchronously inside the user's tap; actual resume is awaited after permission prompts.
      this.audio.prime();
      const motionPermission = await this.motion.requestPermission();
      if (motionPermission === 'denied') throw new Error('Motion access was denied. Enable Motion & Orientation Access in Safari settings.');
      if (motionPermission === 'unavailable') throw new Error('Motion sensors are unavailable in this browser.');
      this.assertPreparingAndVisible();

      const locationPermission = await this.location.requestPermission();
      if (locationPermission === 'denied') throw new Error('Precise location access was denied. It is required during Drive Mode.');
      if (locationPermission === 'unavailable') throw new Error('A precise location could not be obtained. Check Location Services and try again.');
      this.assertPreparingAndVisible();

      await this.audio.unlock();
      this.assertPreparingAndVisible();
      await this.wakeLock.acquire();
      this.assertPreparingAndVisible();
      this.resetLivePipeline();
      this.session = await this.drives.startDrive(DetectionQuality.REDUCED, null);
      this.assertPreparingAndVisible();
      const sensorsStarted = this.motion.start(this);
      const locationStarted = this.location.start(this);
      if (!sensorsStarted || !locationStarted) throw new Error('Drive Mode could not start the required sensors.');

      this.setRuntime({
        ...this.runtime,
        serviceState: DriveServiceState.ACTIVE,
        driveId: this.session.id,
        startedAt: this.session.startedAt,
        detectionQuality: DetectionQuality.REDUCED,
        errorMessage: null,
        foregroundRequired: false
      });
    } catch (error) {
      this.stopProviders();
      await this.wakeLock.release();
      if (this.session !== null) {
        try {
          await this.finishSession(false);
        } catch {
          // Preserve the actionable permission/sensor error even if recovery persistence fails.
        }
      }
      try {
        this.audio.release();
      } catch {
        // Audio is optional; preserve the actionable start failure.
      }
      const message = error instanceof Error ? error.message : 'Drive Mode could not start.';
      this.setRuntime({ ...EMPTY_RUNTIME, serviceState: DriveServiceState.FAILED, errorMessage: message });
      throw new Error(message, { cause: error });
    }
  }

  async pause(): Promise<void> {
    if (!this.isActiveState()) return;
    this.setRuntime({
      ...this.runtime,
      serviceState: DriveServiceState.PAUSED,
      pausedAt: Date.now(),
      currentSpeedMetresPerSecond: null,
      nextBumpDistanceMetres: null
    });
    this.stopProviders();
    this.detector.reset();
    this.approach.reset();
    this.locationHistory.length = 0;
    await this.wakeLock.release();
    await this.drainProcessing();
    await this.persistSession();
  }

  async resume(): Promise<void> {
    if (this.runtime.serviceState !== DriveServiceState.PAUSED &&
      this.runtime.serviceState !== DriveServiceState.BACKGROUND_PAUSED) return;
    if (document.visibilityState !== 'visible') return;
    await this.audio.resume();
    if (!this.isPausedState() || document.visibilityState !== 'visible') return;
    await this.wakeLock.acquire();
    if (!this.isPausedState() || document.visibilityState !== 'visible') {
      await this.wakeLock.release();
      return;
    }
    this.resetLivePipeline(false);
    if (!this.motion.start(this) || !this.location.start(this)) {
      await this.failActive('Drive Mode could not restart the required sensors.');
      return;
    }
    this.setRuntime({
      ...this.runtime,
      serviceState: DriveServiceState.ACTIVE,
      pausedAt: null,
      errorMessage: null,
      foregroundRequired: false
    });
  }

  async end(clean = true): Promise<void> {
    if (this.shutdown !== null) return await this.shutdown;
    const operation = this.performEnd(clean);
    this.shutdown = operation;
    try {
      await operation;
    } finally {
      if (this.shutdown === operation) this.shutdown = null;
    }
  }

  private async performEnd(clean: boolean): Promise<void> {
    if (!this.isRunning() && this.session === null) {
      this.setRuntime({ ...EMPTY_RUNTIME });
      return;
    }
    this.setRuntime({ ...this.runtime, serviceState: DriveServiceState.STOPPING });
    this.stopProviders();
    let failure: unknown = null;
    try {
      await this.wakeLock.release();
      await this.drainProcessing();
      await this.flushTrackPoints();
      await this.finishSession(clean);
    } catch (error) {
      failure = error;
    } finally {
      try {
        this.audio.release();
      } catch {
        // Detection and persistence have already stopped; audio teardown is best-effort.
      } finally {
        this.resetLivePipeline();
        this.session = null;
        this.setRuntime({ ...EMPTY_RUNTIME });
      }
    }
    if (failure instanceof Error) throw failure;
    if (failure !== null) throw new Error('The drive session could not be saved.', { cause: failure });
  }

  async markBump(): Promise<void> {
    if (!this.acceptsSamples()) return;
    await this.bumps.createManualCandidate(this.runtime.driveId, this.runtime.lastLocation, BumpSource.MANUAL);
    this.incrementCandidates();
    this.audio.announce('Speed bump marked.', this.effectiveWarningSettings());
    await this.persistSession();
  }

  toggleMute(): void {
    this.setRuntime({ ...this.runtime, warningsMuted: !this.runtime.warningsMuted });
  }

  onMotion(frame: MotionFrame): void {
    if (!this.acceptsSamples()) return;
    const point = this.runtime.lastLocation;
    const event = this.detector.addSample(
      frame.sample,
      this.runtime.currentSpeedMetresPerSecond ?? 0,
      this.runtime.locationQuality,
      frame.stabilityScore,
      point?.speedAccuracyMetresPerSecond ?? Number.NaN,
      point?.bearingDegrees ?? Number.NaN
    );
    const placement = frame.stabilityScore >= 0.72
      ? PhonePlacementState.STABLE
      : frame.stabilityScore < 0.42
        ? PhonePlacementState.UNSTABLE
        : PhonePlacementState.UNKNOWN;
    const detectionQuality = frame.sample.orientationReliable ? DetectionQuality.FULL : DetectionQuality.REDUCED;
    this.setRuntime({
      ...this.runtime,
      phoneStabilityScore: frame.stabilityScore,
      phonePlacementState: placement,
      detectionQuality
    });
    if (event !== null) this.enqueue(() => this.saveDetectedEvent(event, frame.stabilityScore));
  }

  onLocation(point: GeoPoint, quality: LocationQuality): void {
    if (!this.acceptsSamples()) return;
    this.enqueue(() => this.processLocation(point, quality));
  }

  onError(message: string): void {
    if (!this.isActiveState()) return;
    if (message.includes('permission is missing')) {
      void this.failActive(message).catch(() => {
        this.setRuntime({ ...EMPTY_RUNTIME, serviceState: DriveServiceState.FAILED, errorMessage: message });
      });
      return;
    }
    this.setRuntime({
      ...this.runtime,
      serviceState: DriveServiceState.GPS_DEGRADED,
      locationQuality: LocationQuality.UNAVAILABLE,
      errorMessage: message
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pagehide', this.onPageHide);
    if (this.isRunning()) await this.end(false);
    else {
      this.stopProviders();
      await this.wakeLock.release();
      this.audio.release();
    }
    this.listeners.clear();
  }

  private async processLocation(point: GeoPoint, quality: LocationQuality): Promise<void> {
    if (!this.acceptsSamples()) return;
    this.locationHistory.push(point);
    while (this.locationHistory.length > 60) this.locationHistory.shift();

    if (this.session !== null && this.session.startLatitude === null) {
      this.session = {
        ...this.session,
        startLatitude: point.latitude,
        startLongitude: point.longitude
      };
    }

    let distanceIncrement = 0;
    if (this.previousLocation !== null) {
      const delta = GeoMath.distanceMetres(
        this.previousLocation.latitude,
        this.previousLocation.longitude,
        point.latitude,
        point.longitude
      );
      const elapsedSeconds = (point.elapsedRealtimeNanos - this.previousLocation.elapsedRealtimeNanos) / 1_000_000_000;
      const plausibleLimit = Math.max(80, elapsedSeconds * 65);
      if (delta >= 0.5 && delta <= plausibleLimit) distanceIncrement = delta;
    }
    this.previousLocation = point;

    const speed = Number.isFinite(point.speedMetresPerSecond) && point.speedMetresPerSecond >= 0
      ? point.speedMetresPerSecond
      : null;
    if (speed !== null) {
      this.speedSum += speed;
      this.speedSamples += 1;
      this.maximumSpeed = Math.max(this.maximumSpeed, speed);
    }
    this.setRuntime({
      ...this.runtime,
      serviceState: quality === LocationQuality.POOR || quality === LocationQuality.STALE || quality === LocationQuality.UNAVAILABLE
        ? DriveServiceState.GPS_DEGRADED
        : DriveServiceState.ACTIVE,
      currentSpeedMetresPerSecond: speed,
      distanceMetres: this.runtime.distanceMetres + distanceIncrement,
      gpsAccuracyMetres: Number.isFinite(point.accuracyMetres) ? point.accuracyMetres : null,
      locationQuality: quality,
      lastLocation: point,
      errorMessage: quality === LocationQuality.GOOD || quality === LocationQuality.FAIR ? null : this.runtime.errorMessage
    });
    this.collectRoutePoint(point);
    await this.processApproach(point);
    if (Date.now() - this.lastSessionPersistMillis >= 5_000) await this.persistSession();
  }

  private async saveDetectedEvent(event: DetectedRoadEvent, stabilityScore: number): Promise<void> {
    const estimate = this.locationEstimator.estimate(
      event.features.eventElapsedRealtimeNanos,
      this.locationHistory
    );
    const point = estimate.point;
    const candidate: CandidateEvent = {
      id: createId(),
      driveId: this.runtime.driveId,
      detectedAt: point?.epochMillis && point.epochMillis > 0 ? point.epochMillis : Date.now(),
      eventElapsedRealtimeNanos: event.features.eventElapsedRealtimeNanos,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      horizontalAccuracyMetres: point && Number.isFinite(point.accuracyMetres) ? point.accuracyMetres : null,
      coordinateConfidence: estimate.coordinateConfidence,
      speedMetresPerSecond: point && Number.isFinite(point.speedMetresPerSecond)
        ? point.speedMetresPerSecond
        : this.runtime.currentSpeedMetresPerSecond ?? 0,
      bearingDegrees: point && Number.isFinite(point.bearingDegrees) ? point.bearingDegrees : null,
      confidence: event.confidence,
      eventType: event.eventType,
      decision: CandidateDecision.PENDING,
      confidenceReasons: [...event.confidenceReasons],
      positiveVerticalPeak: event.features.positiveVerticalPeak,
      negativeVerticalPeak: event.features.negativeVerticalPeak,
      peakToPeak: event.features.peakToPeak,
      peakGapMillis: event.features.peakGapMillis,
      verticalRms: event.features.verticalRms,
      jerkPeak: event.features.jerkPeak,
      gyroscopeEnergy: event.features.gyroscopeEnergy,
      orientationVariance: event.features.orientationVariance,
      phoneStability: stabilityScore,
      source: BumpSource.DETECTED,
      note: ''
    };
    await this.bumps.saveCandidate(candidate);
    this.incrementCandidates();
    await this.persistSession();
  }

  private async processApproach(point: GeoPoint): Promise<void> {
    const nearby = await this.bumps.queryWarningCandidates(point, 350);
    if (!this.acceptsSamples()) return;
    const decision = this.approach.update(
      point,
      nearby,
      Date.now(),
      this.settings.warningsEnabled && !this.runtime.warningsMuted,
      this.settings.adaptiveWarningDistance,
      this.settings.fixedWarningDistanceMetres,
      this.settings.warningCooldownSeconds * 1_000
    );
    await this.applyApproachDecision(decision, point);
  }

  private async applyApproachDecision(decision: ApproachDecision, point: GeoPoint): Promise<void> {
    switch (decision.type) {
      case 'none':
        this.setRuntime({ ...this.runtime, nextBumpDistanceMetres: null });
        break;
      case 'tracking':
        this.setRuntime({ ...this.runtime, nextBumpDistanceMetres: decision.distanceMetres });
        break;
      case 'warn':
        this.audio.warnSpeedBump(
          decision.distanceMetres,
          decision.phase === WarningPhase.EARLY
            ? 'EARLY'
            : decision.phase === WarningPhase.MAIN
              ? 'MAIN'
              : 'IMMEDIATE',
          this.effectiveWarningSettings()
        );
        await this.bumps.updateLastWarned(decision.bump.id, Date.now());
        this.setRuntime({
          ...this.runtime,
          nextBumpDistanceMetres: decision.distanceMetres,
          warningCount: this.runtime.warningCount + 1
        });
        break;
      case 'passed':
        await this.bumps.recordEncounter({
          id: createId(),
          bumpId: decision.bump.id,
          candidateId: null,
          driveId: this.runtime.driveId,
          encounteredAt: Date.now(),
          location: point,
          confidence: decision.bump.confidence,
          source: decision.bump.source
        });
        this.setRuntime({
          ...this.runtime,
          knownBumpsPassed: this.runtime.knownBumpsPassed + 1,
          nextBumpDistanceMetres: null
        });
        break;
    }
  }

  private collectRoutePoint(point: GeoPoint): void {
    if (!this.settings.routeHistoryEnabled || this.session === null) return;
    if (this.lastTrackPointNanos !== 0 && point.elapsedRealtimeNanos - this.lastTrackPointNanos < 2_000_000_000) return;
    this.lastTrackPointNanos = point.elapsedRealtimeNanos;
    this.pendingTrackPoints.push({ ...point, driveId: this.session.id });
    if (this.pendingTrackPoints.length >= 10) this.enqueue(() => this.flushTrackPoints());
  }

  private async flushTrackPoints(): Promise<void> {
    if (this.pendingTrackPoints.length === 0) return;
    const batch = this.pendingTrackPoints;
    this.pendingTrackPoints = [];
    try {
      await this.drives.recordTrackPoints(batch);
    } catch {
      this.pendingTrackPoints = [...batch.slice(-12), ...this.pendingTrackPoints].slice(-12);
      this.setRuntime({ ...this.runtime, errorMessage: 'Recent route points could not be saved.' });
    }
  }

  private async persistSession(): Promise<void> {
    if (this.session === null) return;
    this.lastSessionPersistMillis = Date.now();
    this.session = this.sessionFromRuntime(this.session, false);
    await this.drives.updateDrive(this.session);
  }

  private async finishSession(clean: boolean): Promise<void> {
    if (this.session === null) return;
    const completed = this.sessionFromRuntime(this.session, true);
    if (clean) await this.drives.finishDrive(completed);
    else await this.drives.updateDrive({ ...completed, incomplete: true });
    this.session = null;
  }

  private sessionFromRuntime(session: DriveSession, ending: boolean): DriveSession {
    const now = Date.now();
    return {
      ...session,
      endedAt: ending ? now : session.endedAt,
      durationMillis: Math.max(0, now - session.startedAt),
      distanceMetres: this.runtime.distanceMetres,
      maximumSpeedMetresPerSecond: this.maximumSpeed,
      averageSpeedMetresPerSecond: this.speedSamples > 0 ? this.speedSum / this.speedSamples : 0,
      candidateCount: this.runtime.candidateCount,
      knownBumpPasses: this.runtime.knownBumpsPassed,
      warningCount: this.runtime.warningCount,
      endLatitude: ending ? this.runtime.lastLocation?.latitude ?? null : session.endLatitude,
      endLongitude: ending ? this.runtime.lastLocation?.longitude ?? null : session.endLongitude,
      incomplete: true,
      detectionQuality: this.runtime.detectionQuality
    };
  }

  private incrementCandidates(): void {
    this.setRuntime({ ...this.runtime, candidateCount: this.runtime.candidateCount + 1 });
  }

  private effectiveWarningSettings(): AppSettings {
    return this.runtime.warningsMuted ? { ...this.settings, warningsEnabled: false } : this.settings;
  }

  private acceptsSamples(): boolean {
    return document.visibilityState === 'visible' && this.isActiveState();
  }

  private isActiveState(): boolean {
    return [
      DriveServiceState.ACTIVE,
      DriveServiceState.GPS_DEGRADED,
      DriveServiceState.SENSOR_DEGRADED
    ].includes(this.runtime.serviceState);
  }

  private isPausedState(): boolean {
    return this.runtime.serviceState === DriveServiceState.PAUSED ||
      this.runtime.serviceState === DriveServiceState.BACKGROUND_PAUSED;
  }

  private isRunning(): boolean {
    return [
      DriveServiceState.PREPARING,
      DriveServiceState.ACTIVE,
      DriveServiceState.PAUSED,
      DriveServiceState.BACKGROUND_PAUSED,
      DriveServiceState.GPS_DEGRADED,
      DriveServiceState.SENSOR_DEGRADED,
      DriveServiceState.STOPPING
    ].includes(this.runtime.serviceState);
  }

  private resetLivePipeline(resetStatistics = true): void {
    this.detector.reset();
    this.approach.reset();
    this.locationHistory.length = 0;
    this.previousLocation = null;
    if (resetStatistics) {
      this.pendingTrackPoints = [];
      this.lastTrackPointNanos = 0;
      this.speedSum = 0;
      this.speedSamples = 0;
      this.maximumSpeed = 0;
      this.lastSessionPersistMillis = 0;
    }
  }

  private stopProviders(): void {
    this.motion.stop();
    this.location.stop();
  }

  private async failActive(message: string): Promise<void> {
    await this.end(false);
    this.setRuntime({ ...EMPTY_RUNTIME, serviceState: DriveServiceState.FAILED, errorMessage: message });
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.pauseForBackground();
    } else if (this.runtime.serviceState === DriveServiceState.BACKGROUND_PAUSED) {
      void this.resume();
    }
  };

  private readonly onPageHide = (): void => this.pauseForBackground();

  private pauseForBackground(): void {
    if (!this.isActiveState()) return;
    this.setRuntime({
      ...this.runtime,
      serviceState: DriveServiceState.BACKGROUND_PAUSED,
      pausedAt: Date.now(),
      currentSpeedMetresPerSecond: null,
      nextBumpDistanceMetres: null,
      foregroundRequired: true,
      errorMessage: 'Detection paused while BumpCompanion was hidden.'
    });
    this.stopProviders();
    this.detector.reset();
    this.approach.reset();
    this.locationHistory.length = 0;
    if (this.session !== null) {
      this.session = { ...this.session, serviceInterruptions: this.session.serviceInterruptions + 1 };
    }
    void this.persistBackgroundPause().catch(() => {
      if (this.isPausedState()) {
        this.setRuntime({ ...this.runtime, errorMessage: 'The paused drive could not be saved yet.' });
      }
    });
  }

  private enqueue(operation: () => Promise<void>): void {
    this.processing = this.processing.then(operation).catch(() => {
      this.setRuntime({ ...this.runtime, errorMessage: 'Something went wrong. Please try again.' });
    });
  }

  private setRuntime(next: DriveRuntimeState): void {
    this.runtime = next;
    this.listeners.forEach((listener) => listener());
  }

  private assertPreparingAndVisible(): void {
    if (this.runtime.serviceState !== DriveServiceState.PREPARING) {
      throw new Error('Drive Mode start was cancelled.');
    }
    if (document.visibilityState !== 'visible') {
      throw new Error('Keep BumpCompanion open while starting Drive Mode.');
    }
  }

  private async drainProcessing(): Promise<void> {
    for (;;) {
      const pending = this.processing;
      await pending;
      if (pending === this.processing) return;
    }
  }

  private async persistBackgroundPause(): Promise<void> {
    await this.wakeLock.release();
    await this.drainProcessing();
    await this.flushTrackPoints();
    await this.persistSession();
  }
}
