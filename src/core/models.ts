export enum BumpStatus {
  CONFIRMED = 'CONFIRMED',
  PENDING = 'PENDING',
  IMPORTED = 'IMPORTED',
  ARCHIVED = 'ARCHIVED',
  REMOVED = 'REMOVED'
}

export enum BumpSource {
  DETECTED = 'DETECTED',
  MANUAL = 'MANUAL',
  IMPORTED = 'IMPORTED',
  SIMULATION = 'SIMULATION'
}

export enum Directionality {
  BIDIRECTIONAL = 'BIDIRECTIONAL',
  ONE_DIRECTION = 'ONE_DIRECTION',
  TWO_CLUSTERS = 'TWO_CLUSTERS',
  UNKNOWN = 'UNKNOWN'
}

export enum RoadEventType {
  LIKELY_SPEED_BUMP = 'LIKELY_SPEED_BUMP',
  POSSIBLE_SPEED_BUMP = 'POSSIBLE_SPEED_BUMP',
  POTHOLE_LIKE = 'POTHOLE_LIKE',
  ROUGH_ROAD = 'ROUGH_ROAD',
  PHONE_MOVEMENT = 'PHONE_MOVEMENT',
  HARD_BRAKING = 'HARD_BRAKING',
  UNKNOWN = 'UNKNOWN',
  DISCARDED = 'DISCARDED'
}

export enum CandidateDecision {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  NOT_SURE = 'NOT_SURE',
  POTHOLE = 'POTHOLE',
  ROUGH_ROAD = 'ROUGH_ROAD'
}

export enum DetectionQuality {
  FULL = 'FULL',
  REDUCED = 'REDUCED',
  BASIC = 'BASIC',
  UNSUPPORTED = 'UNSUPPORTED'
}

export enum LocationQuality {
  GOOD = 'GOOD',
  FAIR = 'FAIR',
  POOR = 'POOR',
  STALE = 'STALE',
  UNAVAILABLE = 'UNAVAILABLE'
}

export enum PhonePlacementState {
  STABLE = 'STABLE',
  UNSTABLE = 'UNSTABLE',
  UNKNOWN = 'UNKNOWN'
}

export enum DriveServiceState {
  IDLE = 'IDLE',
  PREPARING = 'PREPARING',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  BACKGROUND_PAUSED = 'BACKGROUND_PAUSED',
  GPS_DEGRADED = 'GPS_DEGRADED',
  SENSOR_DEGRADED = 'SENSOR_DEGRADED',
  PERMISSION_LOST = 'PERMISSION_LOST',
  STOPPING = 'STOPPING',
  FAILED = 'FAILED'
}

export enum Sensitivity {
  CONSERVATIVE = 'CONSERVATIVE',
  BALANCED = 'BALANCED',
  SENSITIVE = 'SENSITIVE'
}

export enum ThemeMode {
  SYSTEM = 'SYSTEM',
  LIGHT = 'LIGHT',
  DARK = 'DARK'
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  bearingDegrees: number;
  speedMetresPerSecond: number;
  elapsedRealtimeNanos: number;
  epochMillis: number;
  speedAccuracyMetresPerSecond: number;
}

export interface SpeedBump {
  id: string;
  latitude: number;
  longitude: number;
  rawLatitude: number;
  rawLongitude: number;
  horizontalAccuracyMetres: number;
  coordinateConfidence: number;
  confidence: number;
  status: BumpStatus;
  source: BumpSource;
  directionality: Directionality;
  primaryBearing: number | null;
  oppositeBearing: number | null;
  bearingTolerance: number;
  firstDetectedAt: number;
  lastDetectedAt: number;
  lastWarnedAt: number | null;
  encounterCount: number;
  confirmationCount: number;
  rejectionCount: number;
  missingReports: number;
  importedSource: string | null;
  notes: string;
  warningEnabled: boolean;
  customWarningDistanceMetres: number | null;
  algorithmVersion: number;
  archived: boolean;
  markedRemoved: boolean;
  regionLabel: string | null;
  roadName: string | null;
}

export interface CandidateEvent {
  id: string;
  driveId: string | null;
  detectedAt: number;
  eventElapsedRealtimeNanos: number;
  latitude: number | null;
  longitude: number | null;
  horizontalAccuracyMetres: number | null;
  coordinateConfidence: number;
  speedMetresPerSecond: number;
  bearingDegrees: number | null;
  confidence: number;
  eventType: RoadEventType;
  decision: CandidateDecision;
  confidenceReasons: string[];
  positiveVerticalPeak: number;
  negativeVerticalPeak: number;
  peakToPeak: number;
  peakGapMillis: number;
  verticalRms: number;
  jerkPeak: number;
  gyroscopeEnergy: number;
  orientationVariance: number;
  phoneStability: number;
  source: BumpSource;
  note: string;
}

export interface DriveSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  durationMillis: number;
  distanceMetres: number;
  maximumSpeedMetresPerSecond: number;
  averageSpeedMetresPerSecond: number;
  candidateCount: number;
  confirmedCount: number;
  rejectedCount: number;
  knownBumpPasses: number;
  warningCount: number;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
  incomplete: boolean;
  placementProfile: string;
  vehicleProfile: string | null;
  algorithmVersion: number;
  serviceInterruptions: number;
  detectionQuality: DetectionQuality;
}

export interface LocationTrackPoint extends GeoPoint {
  driveId: string;
}

export interface CalibrationProfile {
  id: string;
  createdAt: number;
  accelerometerNoiseRms: number;
  gyroscopeNoiseRms: number;
  gravityX: number;
  gravityY: number;
  gravityZ: number;
  samplingConsistency: number;
  engineVibrationRms: number;
  sampleCount: number;
  algorithmVersion: number;
}

export interface EncounterSummary {
  id: string;
  bumpId: string | null;
  candidateId: string | null;
  driveId: string | null;
  encounteredAt: number;
  location: GeoPoint;
  confidence: number;
  source: BumpSource;
}

export interface AppSettings {
  onboardingComplete: boolean;
  sensitivity: Sensitivity;
  warningsEnabled: boolean;
  voiceEnabled: boolean;
  toneEnabled: boolean;
  vibrationEnabled: boolean;
  adaptiveWarningDistance: boolean;
  fixedWarningDistanceMetres: number;
  warningCooldownSeconds: number;
  routeHistoryEnabled: boolean;
  candidateNotificationEnabled: boolean;
  metricUnits: boolean;
  themeMode: ThemeMode;
  dynamicColour: boolean;
  reducedMotion: boolean;
  repeatEvidenceAutoConfirmation: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  onboardingComplete: false,
  sensitivity: Sensitivity.BALANCED,
  warningsEnabled: true,
  voiceEnabled: true,
  toneEnabled: true,
  vibrationEnabled: true,
  adaptiveWarningDistance: true,
  fixedWarningDistanceMetres: 100,
  warningCooldownSeconds: 45,
  routeHistoryEnabled: false,
  candidateNotificationEnabled: false,
  metricUnits: true,
  themeMode: ThemeMode.SYSTEM,
  dynamicColour: true,
  reducedMotion: false,
  repeatEvidenceAutoConfirmation: false
};

export interface DriveRuntimeState {
  serviceState: DriveServiceState;
  driveId: string | null;
  startedAt: number | null;
  pausedAt: number | null;
  currentSpeedMetresPerSecond: number | null;
  distanceMetres: number;
  gpsAccuracyMetres: number | null;
  locationQuality: LocationQuality;
  detectionQuality: DetectionQuality;
  phonePlacementState: PhonePlacementState;
  phoneStabilityScore: number;
  candidateCount: number;
  knownBumpsPassed: number;
  warningCount: number;
  nextBumpDistanceMetres: number | null;
  warningsMuted: boolean;
  lastLocation: GeoPoint | null;
  errorMessage: string | null;
  foregroundRequired: boolean;
}

export const EMPTY_RUNTIME: DriveRuntimeState = {
  serviceState: DriveServiceState.IDLE,
  driveId: null,
  startedAt: null,
  pausedAt: null,
  currentSpeedMetresPerSecond: null,
  distanceMetres: 0,
  gpsAccuracyMetres: null,
  locationQuality: LocationQuality.UNAVAILABLE,
  detectionQuality: DetectionQuality.UNSUPPORTED,
  phonePlacementState: PhonePlacementState.UNKNOWN,
  phoneStabilityScore: 0,
  candidateCount: 0,
  knownBumpsPassed: 0,
  warningCount: 0,
  nextBumpDistanceMetres: null,
  warningsMuted: false,
  lastLocation: null,
  errorMessage: null,
  foregroundRequired: false
};

export function createId(): string {
  return crypto.randomUUID();
}

export function createSpeedBump(
  input: Pick<SpeedBump, 'latitude' | 'longitude'> & Partial<SpeedBump>
): SpeedBump {
  const now = Date.now();
  const { latitude, longitude, ...overrides } = input;
  return {
    id: createId(),
    latitude,
    longitude,
    rawLatitude: latitude,
    rawLongitude: longitude,
    horizontalAccuracyMetres: Number.NaN,
    coordinateConfidence: 0.5,
    confidence: 0.5,
    status: BumpStatus.CONFIRMED,
    source: BumpSource.DETECTED,
    directionality: Directionality.UNKNOWN,
    primaryBearing: null,
    oppositeBearing: null,
    bearingTolerance: 45,
    firstDetectedAt: now,
    lastDetectedAt: now,
    lastWarnedAt: null,
    encounterCount: 1,
    confirmationCount: 1,
    rejectionCount: 0,
    missingReports: 0,
    importedSource: null,
    notes: '',
    warningEnabled: true,
    customWarningDistanceMetres: null,
    algorithmVersion: 2,
    archived: false,
    markedRemoved: false,
    regionLabel: null,
    roadName: null,
    ...overrides
  };
}
