import { Sensitivity } from '../models';

export interface ConfidenceWeights {
  waveform: number;
  isolation: number;
  verticalDominance: number;
  signalToNoise: number;
  duration: number;
  settling: number;
  wholeVehicleCoherence: number;
  signalQuality: number;
  brakingContext: number;
  postAccelerationContext: number;
  roughRoadPenalty: number;
  potholePenalty: number;
  phoneMovementPenalty: number;
  turnPenalty: number;
  hillOrRampPenalty: number;
  highFrequencyPenalty: number;
  clippingPenalty: number;
}

export interface DetectorConfiguration {
  version: number;
  expectedSampleRateHz: number;
  historySeconds: number;
  preEventWindowMillis: number;
  minimumEventDurationMillis: number;
  maximumEventDurationMillis: number;
  eventEndQuietMillis: number;
  postEventWindowMillis: number;
  sameEventRefractoryMillis: number;
  minimumSpeedMetresPerSecond: number;
  recentMovingMemoryMillis: number;
  gpsDropoutStrongSignalMultiplier: number;
  poorSpeedAccuracyMetresPerSecond: number;
  driftLowPassCutoffHz: number;
  eventLowPassCutoffHz: number;
  highFrequencySplitHz: number;
  envelopeLowPassCutoffHz: number;
  broadMotionLowPassCutoffHz: number;
  minimumPhysicalPeakMetresPerSecondSquared: number;
  candidateSignalToNoiseRatio: number;
  eventReleaseRatio: number;
  minimumOpposingLobeRatio: number;
  minimumPeakGapMillis: number;
  maximumPeakGapMillis: number;
  initialBaselineVerticalRms: number;
  minimumBaselineVerticalRms: number;
  maximumBaselineVerticalRms: number;
  baselineTimeConstantSeconds: number;
  baselineRiseRateMultiplier: number;
  baselineOutlierSigma: number;
  automaticCalibrationSeconds: number;
  roughRoadThreshold: number;
  veryRoughRoadThreshold: number;
  roughRoadMinimumWaveformScore: number;
  strongPotholeLikelihood: number;
  severePhoneMovementLikelihood: number;
  phoneOrientationStepRadians: number;
  sensorSaturationMetresPerSecondSquared: number;
  maximumContinuousSampleGapMillis: number;
  localCandidateThreshold: number;
  probableThreshold: number;
  databaseWorthyThreshold: number;
  minimumWaveformScore: number;
  sensitivityScoreOffset: number;
  weights: ConfidenceWeights;
}

export const DEFAULT_CONFIDENCE_WEIGHTS: Readonly<ConfidenceWeights> = Object.freeze({
  waveform: 0.3,
  isolation: 0.13,
  verticalDominance: 0.1,
  signalToNoise: 0.1,
  duration: 0.07,
  settling: 0.06,
  wholeVehicleCoherence: 0.06,
  signalQuality: 0.06,
  brakingContext: 0.035,
  postAccelerationContext: 0.025,
  roughRoadPenalty: 0.3,
  potholePenalty: 0.37,
  phoneMovementPenalty: 0.52,
  turnPenalty: 0.13,
  hillOrRampPenalty: 0.23,
  highFrequencyPenalty: 0.14,
  clippingPenalty: 0.3
});

export const DEFAULT_DETECTOR_CONFIGURATION: Readonly<DetectorConfiguration> = Object.freeze({
  version: 2,
  expectedSampleRateHz: 100,
  historySeconds: 10,
  preEventWindowMillis: 1_600,
  minimumEventDurationMillis: 120,
  maximumEventDurationMillis: 4_800,
  eventEndQuietMillis: 320,
  postEventWindowMillis: 430,
  sameEventRefractoryMillis: 260,
  minimumSpeedMetresPerSecond: 1.25,
  recentMovingMemoryMillis: 5_000,
  gpsDropoutStrongSignalMultiplier: 2.6,
  poorSpeedAccuracyMetresPerSecond: 2.5,
  driftLowPassCutoffHz: 0.2,
  eventLowPassCutoffHz: 5.2,
  highFrequencySplitHz: 9,
  envelopeLowPassCutoffHz: 2.2,
  broadMotionLowPassCutoffHz: 1.35,
  minimumPhysicalPeakMetresPerSecondSquared: 0.62,
  candidateSignalToNoiseRatio: 3,
  eventReleaseRatio: 0.44,
  minimumOpposingLobeRatio: 0.23,
  minimumPeakGapMillis: 55,
  maximumPeakGapMillis: 2_900,
  initialBaselineVerticalRms: 0.22,
  minimumBaselineVerticalRms: 0.1,
  maximumBaselineVerticalRms: 1.35,
  baselineTimeConstantSeconds: 24,
  baselineRiseRateMultiplier: 0.14,
  baselineOutlierSigma: 2.8,
  automaticCalibrationSeconds: 8,
  roughRoadThreshold: 0.58,
  veryRoughRoadThreshold: 0.78,
  roughRoadMinimumWaveformScore: 0.66,
  strongPotholeLikelihood: 0.74,
  severePhoneMovementLikelihood: 0.78,
  phoneOrientationStepRadians: 0.15,
  sensorSaturationMetresPerSecondSquared: 75,
  maximumContinuousSampleGapMillis: 180,
  localCandidateThreshold: 0.59,
  probableThreshold: 0.72,
  databaseWorthyThreshold: 0.86,
  minimumWaveformScore: 0.36,
  sensitivityScoreOffset: 0,
  weights: DEFAULT_CONFIDENCE_WEIGHTS
});

export type DetectorConfigurationOverrides = Partial<Omit<DetectorConfiguration, 'weights'>> & {
  weights?: Partial<ConfidenceWeights>;
};

export function createDetectorConfiguration(overrides: DetectorConfigurationOverrides = {}): DetectorConfiguration {
  return {
    ...DEFAULT_DETECTOR_CONFIGURATION,
    ...overrides,
    weights: { ...DEFAULT_CONFIDENCE_WEIGHTS, ...overrides.weights }
  };
}

export function detectorConfigurationForSensitivity(sensitivity: Sensitivity): DetectorConfiguration {
  switch (sensitivity) {
    case Sensitivity.CONSERVATIVE:
      return createDetectorConfiguration({
        minimumSpeedMetresPerSecond: 1.55,
        minimumPhysicalPeakMetresPerSecondSquared: 0.78,
        candidateSignalToNoiseRatio: 3.45,
        roughRoadMinimumWaveformScore: 0.72,
        localCandidateThreshold: 0.67,
        probableThreshold: 0.78,
        databaseWorthyThreshold: 0.9,
        minimumWaveformScore: 0.44,
        sensitivityScoreOffset: -0.02
      });
    case Sensitivity.SENSITIVE:
      return createDetectorConfiguration({
        minimumSpeedMetresPerSecond: 0.9,
        minimumPhysicalPeakMetresPerSecondSquared: 0.48,
        candidateSignalToNoiseRatio: 2.55,
        roughRoadMinimumWaveformScore: 0.61,
        localCandidateThreshold: 0.53,
        probableThreshold: 0.67,
        databaseWorthyThreshold: 0.83,
        minimumWaveformScore: 0.31,
        sensitivityScoreOffset: 0.035
      });
    case Sensitivity.BALANCED:
    default:
      return createDetectorConfiguration();
  }
}

export function sameDetectorConfiguration(a: DetectorConfiguration, b: DetectorConfiguration): boolean {
  const keys = Object.keys(a) as Array<keyof DetectorConfiguration>;
  return keys.every((key) => {
    if (key === 'weights') {
      const weightKeys = Object.keys(a.weights) as Array<keyof ConfidenceWeights>;
      return weightKeys.every((weightKey) => a.weights[weightKey] === b.weights[weightKey]);
    }
    return a[key] === b[key];
  });
}
