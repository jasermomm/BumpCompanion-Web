import { describe, expect, it } from 'vitest';
import { Sensitivity } from '../../src/core/models';
import {
  DEFAULT_DETECTOR_CONFIGURATION,
  detectorConfigurationForSensitivity
} from '../../src/core/detector';

describe('detector-v2 production configuration', () => {
  it('locks the complete balanced constant set and confidence weights', () => {
    expect(DEFAULT_DETECTOR_CONFIGURATION).toMatchObject({
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
      weights: {
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
      }
    });
  });

  it('applies the exact conservative and sensitive profile overrides', () => {
    expect(detectorConfigurationForSensitivity(Sensitivity.CONSERVATIVE)).toMatchObject({
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
    expect(detectorConfigurationForSensitivity(Sensitivity.SENSITIVE)).toMatchObject({
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
  });
});
