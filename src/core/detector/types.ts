import type { GeoPoint } from '../models';
import { LocationQuality, RoadEventType } from '../models';

export interface MotionSample {
  elapsedRealtimeNanos: number;
  epochMillis: number;
  accelerationX: number;
  accelerationY: number;
  accelerationZ: number;
  gyroscopeX: number;
  gyroscopeY: number;
  gyroscopeZ: number;
  verticalAcceleration: number;
  longitudinalAcceleration: number;
  lateralAcceleration: number;
  orientationChangeRadians: number;
  orientationReliable: boolean;
  worldAccelerationEast: number;
  worldAccelerationNorth: number;
  linearAccelerationAvailable: boolean;
  linearAccelerationX: number;
  linearAccelerationY: number;
  linearAccelerationZ: number;
  gravityX: number;
  gravityY: number;
  gravityZ: number;
  rotationVectorX: number;
  rotationVectorY: number;
  rotationVectorZ: number;
  rotationVectorW: number;
}

export type MotionSampleInput = Pick<
  MotionSample,
  | 'elapsedRealtimeNanos'
  | 'epochMillis'
  | 'accelerationX'
  | 'accelerationY'
  | 'accelerationZ'
  | 'verticalAcceleration'
> &
  Partial<Omit<MotionSample, 'elapsedRealtimeNanos' | 'epochMillis' | 'accelerationX' | 'accelerationY' | 'accelerationZ' | 'verticalAcceleration'>>;

/** Applies the same defaults as the Android MotionSample data class. */
export function createMotionSample(input: MotionSampleInput): MotionSample {
  return {
    gyroscopeX: 0,
    gyroscopeY: 0,
    gyroscopeZ: 0,
    longitudinalAcceleration: 0,
    lateralAcceleration: 0,
    orientationChangeRadians: 0,
    orientationReliable: false,
    worldAccelerationEast: Number.NaN,
    worldAccelerationNorth: Number.NaN,
    linearAccelerationAvailable: false,
    linearAccelerationX: Number.NaN,
    linearAccelerationY: Number.NaN,
    linearAccelerationZ: Number.NaN,
    gravityX: Number.NaN,
    gravityY: Number.NaN,
    gravityZ: Number.NaN,
    rotationVectorX: Number.NaN,
    rotationVectorY: Number.NaN,
    rotationVectorZ: Number.NaN,
    rotationVectorW: Number.NaN,
    ...input
  };
}

export enum BumpProfile {
  SHORT_SHARP = 'SHORT_SHARP',
  LONG_SMOOTH_HUMP = 'LONG_SMOOTH_HUMP',
  FLAT_TOP_TABLE = 'FLAT_TOP_TABLE',
  LOW_PROFILE = 'LOW_PROFILE',
  DOUBLE_AXLE = 'DOUBLE_AXLE',
  ASYMMETRIC = 'ASYMMETRIC',
  CONSECUTIVE = 'CONSECUTIVE',
  UNCLASSIFIED = 'UNCLASSIFIED'
}

export enum RoadSurfaceState {
  SMOOTH = 'SMOOTH',
  NORMAL = 'NORMAL',
  ROUGH = 'ROUGH',
  VERY_ROUGH = 'VERY_ROUGH'
}

export enum DetectorState {
  CALIBRATING = 'CALIBRATING',
  NORMAL = 'NORMAL',
  CAPTURING = 'CAPTURING',
  SETTLING = 'SETTLING',
  REFRACTORY = 'REFRACTORY',
  SUPPRESSED = 'SUPPRESSED'
}

export enum DetectionDisposition {
  REJECTED = 'REJECTED',
  LOCAL_CANDIDATE = 'LOCAL_CANDIDATE',
  DATABASE_WORTHY = 'DATABASE_WORTHY'
}

export enum ConfidenceReason {
  OPPOSING_VERTICAL_PEAKS = 'OPPOSING_VERTICAL_PEAKS',
  BUMP_LIKE_PEAK_TIMING = 'BUMP_LIKE_PEAK_TIMING',
  ORIENTATION_STABLE = 'ORIENTATION_STABLE',
  ORIENTATION_CHANGED = 'ORIENTATION_CHANGED',
  PHONE_UNSTABLE = 'PHONE_UNSTABLE',
  GPS_POOR = 'GPS_POOR',
  VEHICLE_SLOWED = 'VEHICLE_SLOWED',
  SENSOR_CLIPPING = 'SENSOR_CLIPPING',
  STRONG_LATERAL_MOVEMENT = 'STRONG_LATERAL_MOVEMENT',
  POTHOLE_LIKE_IMPULSE = 'POTHOLE_LIKE_IMPULSE',
  MANUALLY_MARKED = 'MANUALLY_MARKED',
  SINGLE_SHARP_IMPULSE = 'SINGLE_SHARP_IMPULSE',
  NO_PAIRED_SEQUENCE = 'NO_PAIRED_SEQUENCE',
  SIMULATED_EVENT = 'SIMULATED_EVENT',
  STRUCTURED_WAVEFORM = 'STRUCTURED_WAVEFORM',
  ISOLATED_EVENT = 'ISOLATED_EVENT',
  VERTICAL_DOMINANT = 'VERTICAL_DOMINANT',
  SUSPENSION_SETTLING = 'SUSPENSION_SETTLING',
  LONG_SMOOTH_PROFILE = 'LONG_SMOOTH_PROFILE',
  DOUBLE_AXLE_PROFILE = 'DOUBLE_AXLE_PROFILE',
  LOW_PROFILE_EVENT = 'LOW_PROFILE_EVENT',
  ROUGH_ROAD_CONTEXT = 'ROUGH_ROAD_CONTEXT',
  HIGH_FREQUENCY_VIBRATION = 'HIGH_FREQUENCY_VIBRATION',
  PHONE_MOVEMENT_LIKELY = 'PHONE_MOVEMENT_LIKELY',
  TURNING_CONTEXT = 'TURNING_CONTEXT',
  HILL_OR_RAMP_LIKELY = 'HILL_OR_RAMP_LIKELY',
  SPEED_CONTEXT_UNCERTAIN = 'SPEED_CONTEXT_UNCERTAIN',
  SENSOR_QUALITY_REDUCED = 'SENSOR_QUALITY_REDUCED',
  POST_EVENT_ACCELERATION = 'POST_EVENT_ACCELERATION'
}

export interface ProcessedSample {
  motion: MotionSample;
  speedMetresPerSecond: number;
  speedAccuracyMetresPerSecond: number;
  locationQuality: LocationQuality;
  phoneStabilityScore: number;
  eventVertical: number;
  broadVertical: number;
  highFrequencyVertical: number;
  envelope: number;
  verticalJerk: number;
  horizontalBand: number;
  gyroMagnitude: number;
  sampleGap: boolean;
}

export interface EventFeatures {
  eventElapsedRealtimeNanos: number;
  positiveVerticalPeak: number;
  negativeVerticalPeak: number;
  peakToPeak: number;
  positivePeakTimeNanos: number;
  negativePeakTimeNanos: number;
  peakGapMillis: number;
  durationMillis: number;
  verticalRms: number;
  verticalEnergy: number;
  jerkPeak: number;
  longitudinalBefore: number;
  longitudinalDuring: number;
  lateralEnergy: number;
  gyroscopeEnergy: number;
  orientationVariance: number;
  sensorSaturated: boolean;
  baselineNoiseRatio: number;
  horizontalRms: number;
  jerkRms: number;
  highFrequencyRms: number;
  highFrequencyRatio: number;
  lowFrequencyRms: number;
  zeroCrossingCount: number;
  prominentPeakCount: number;
  coherentPairCount: number;
  dominantPeakWidthMillis: number;
  eventIsolation: number;
  verticalDominance: number;
  waveformSymmetry: number;
  lobeBalance: number;
  settlingScore: number;
  wholeVehicleCoherence: number;
  approximateVerticalDisplacementMetres: number;
  preEventVerticalRms: number;
  postEventVerticalRms: number;
  preEventSpeedMetresPerSecond: number;
  minimumEventSpeedMetresPerSecond: number;
  postEventSpeedMetresPerSecond: number;
  absoluteSpeedReductionMetresPerSecond: number;
  relativeSpeedReduction: number;
  decelerationRateMetresPerSecondSquared: number;
  accelerationRateMetresPerSecondSquared: number;
  brakingEvidence: number;
  postAccelerationEvidence: number;
  gyroscopeRms: number;
  maximumOrientationStepRadians: number;
  orientationReliability: number;
  sampleRateHz: number;
  droppedSampleFraction: number;
  signalQuality: number;
  roughnessScore: number;
  potholeLikelihood: number;
  phoneMovementLikelihood: number;
  turnLikelihood: number;
  hillOrRampLikelihood: number;
  bumpWaveformScore: number;
  profile: BumpProfile;
  profileScores: Readonly<Partial<Record<BumpProfile, number>>>;
  roadSurfaceState: RoadSurfaceState;
}

export function toMlFeatureVector(features: EventFeatures): number[] {
  const finiteOrZero = (value: number): number => (Number.isFinite(value) ? value : 0);
  return [
    features.positiveVerticalPeak,
    features.negativeVerticalPeak,
    features.peakToPeak,
    features.peakGapMillis,
    features.durationMillis,
    features.verticalRms,
    features.horizontalRms,
    features.jerkPeak,
    features.jerkRms,
    features.highFrequencyRms,
    features.highFrequencyRatio,
    features.lowFrequencyRms,
    features.zeroCrossingCount,
    features.prominentPeakCount,
    features.coherentPairCount,
    features.dominantPeakWidthMillis,
    features.eventIsolation,
    features.verticalDominance,
    features.waveformSymmetry,
    features.lobeBalance,
    features.settlingScore,
    features.wholeVehicleCoherence,
    features.approximateVerticalDisplacementMetres,
    features.preEventVerticalRms,
    features.postEventVerticalRms,
    finiteOrZero(features.preEventSpeedMetresPerSecond),
    finiteOrZero(features.minimumEventSpeedMetresPerSecond),
    finiteOrZero(features.postEventSpeedMetresPerSecond),
    features.absoluteSpeedReductionMetresPerSecond,
    features.relativeSpeedReduction,
    features.decelerationRateMetresPerSecondSquared,
    features.accelerationRateMetresPerSecondSquared,
    features.brakingEvidence,
    features.postAccelerationEvidence,
    features.gyroscopeRms,
    features.maximumOrientationStepRadians,
    features.orientationReliability,
    features.sampleRateHz,
    features.droppedSampleFraction,
    features.signalQuality,
    features.roughnessScore,
    features.potholeLikelihood,
    features.phoneMovementLikelihood,
    features.turnLikelihood,
    features.hillOrRampLikelihood,
    features.bumpWaveformScore
  ];
}

export interface ScoreContribution {
  name: string;
  value: number;
  detail: string;
}

export interface CandidateEvaluation {
  candidateNumber: number;
  detectorState: DetectorState;
  eventType: RoadEventType;
  disposition: DetectionDisposition;
  confidence: number;
  databaseConfidence: number;
  features: EventFeatures | null;
  contributions: readonly ScoreContribution[];
  explanation: string;
}

export interface DetectorTelemetryFrame {
  sample: MotionSample;
  speedMetresPerSecond: number;
  speedAccuracyMetresPerSecond: number;
  locationQuality: LocationQuality;
  phoneStabilityScore: number;
  eventVerticalAcceleration: number;
  lowFrequencyVerticalAcceleration: number;
  highFrequencyVerticalAcceleration: number;
  verticalEnvelope: number;
  verticalJerk: number;
  horizontalAcceleration: number;
  baselineVerticalRms: number;
  baselineHighFrequencyRms: number;
  roadSurfaceState: RoadSurfaceState;
  detectorState: DetectorState;
}

export interface DetectorDiagnosticsListener {
  onFrame?(frame: DetectorTelemetryFrame): void;
  onCandidate?(evaluation: CandidateEvaluation): void;
}

export interface DetectedRoadEvent {
  eventType: RoadEventType;
  confidence: number;
  features: EventFeatures;
  confidenceReasons: readonly ConfidenceReason[];
  profile: BumpProfile;
  disposition: DetectionDisposition;
  databaseConfidence: number;
  scoreContributions: readonly ScoreContribution[];
  explanation: string;
}

export interface DetectorSampleContext {
  speedMetresPerSecond: number;
  locationQuality: LocationQuality;
  phoneStabilityScore: number;
  speedAccuracyMetresPerSecond?: number;
  bearingDegrees?: number;
}

export interface TransformedAcceleration {
  vertical: number;
  longitudinal: number;
  lateral: number;
  worldEast: number;
  worldNorth: number;
  orientationChange: number;
  reliable: boolean;
}

export interface EventLocationEstimate {
  point: GeoPoint | null;
  coordinateConfidence: number;
  method: 'unavailable' | 'stale' | 'interpolated' | 'projected' | 'nearest';
  correctionDistanceMetres: number;
}

export { LocationQuality, RoadEventType };
