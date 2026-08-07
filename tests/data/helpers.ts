import {
  BumpSource,
  BumpStatus,
  CandidateDecision,
  DetectionQuality,
  Directionality,
  RoadEventType,
  createSpeedBump,
  type CandidateEvent,
  type DriveSession,
  type GeoPoint,
  type SpeedBump
} from '../../src/core/models';

export function makePoint(overrides: Partial<GeoPoint> = {}): GeoPoint {
  return {
    latitude: 30,
    longitude: 31,
    accuracyMetres: 8,
    bearingDegrees: 0,
    speedMetresPerSecond: 10,
    elapsedRealtimeNanos: 1_000_000_000,
    epochMillis: 1_000,
    speedAccuracyMetresPerSecond: 0.5,
    ...overrides
  };
}
export function makeBump(overrides: Partial<SpeedBump> = {}): SpeedBump {
  return createSpeedBump({
    id: overrides.id ?? crypto.randomUUID(),
    latitude: overrides.latitude ?? 30.001,
    longitude: overrides.longitude ?? 31,
    rawLatitude: overrides.rawLatitude ?? overrides.latitude ?? 30.001,
    rawLongitude: overrides.rawLongitude ?? overrides.longitude ?? 31,
    horizontalAccuracyMetres: 8,
    coordinateConfidence: 0.9,
    confidence: 0.9,
    status: BumpStatus.CONFIRMED,
    source: BumpSource.DETECTED,
    directionality: Directionality.BIDIRECTIONAL,
    firstDetectedAt: 1_000,
    lastDetectedAt: 1_000,
    ...overrides
  });
}

export function makeCandidate(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
  return {
    id: crypto.randomUUID(),
    driveId: null,
    detectedAt: 2_000,
    eventElapsedRealtimeNanos: 2_000_000_000,
    latitude: 30.001,
    longitude: 31,
    horizontalAccuracyMetres: 8,
    coordinateConfidence: 0.9,
    speedMetresPerSecond: 10,
    bearingDegrees: 0,
    confidence: 0.85,
    eventType: RoadEventType.LIKELY_SPEED_BUMP,
    decision: CandidateDecision.PENDING,
    confidenceReasons: ['OPPOSING_VERTICAL_PEAKS'],
    positiveVerticalPeak: 4,
    negativeVerticalPeak: -3,
    peakToPeak: 7,
    peakGapMillis: 300,
    verticalRms: 1,
    jerkPeak: 20,
    gyroscopeEnergy: 0.1,
    orientationVariance: 0.01,
    phoneStability: 0.9,
    source: BumpSource.DETECTED,
    note: '',
    ...overrides
  };
}

export function makeDrive(overrides: Partial<DriveSession> = {}): DriveSession {
  return {
    id: crypto.randomUUID(),
    startedAt: 1_000,
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
    detectionQuality: DetectionQuality.FULL,
    ...overrides
  };
}
