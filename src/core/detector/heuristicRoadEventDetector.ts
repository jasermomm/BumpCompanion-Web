import { Sensitivity } from '../models';
import type { DetectorConfiguration } from './configuration';
import {
  detectorConfigurationForSensitivity,
  sameDetectorConfiguration
} from './configuration';
import { AdaptiveRoadBaseline, type RoadBaselineSnapshot } from './adaptiveRoadBaseline';
import { FeatureExtractor } from './featureExtractor';
import { clamp, normalized } from './math';
import { BoundedRingBuffer } from './ringBuffer';
import { SignalProcessor } from './signalProcessing';
import type {
  CandidateEvaluation,
  DetectedRoadEvent,
  DetectorDiagnosticsListener,
  EventFeatures,
  MotionSample,
  ProcessedSample,
  ScoreContribution
} from './types';
import {
  BumpProfile,
  ConfidenceReason,
  DetectionDisposition,
  DetectorState,
  LocationQuality,
  RoadEventType,
  RoadSurfaceState
} from './types';

export interface RoadEventDetector {
  updateConfiguration(configuration: DetectorConfiguration): void;
  addSample(
    sample: MotionSample,
    speedMetresPerSecond: number,
    locationQuality: LocationQuality,
    phoneStabilityScore: number,
    speedAccuracyMetresPerSecond?: number,
    bearingDegrees?: number
  ): DetectedRoadEvent | null;
  setDiagnosticsListener(listener: DetectorDiagnosticsListener | null): void;
  reset(): void;
}

interface ScoredCandidate {
  confidence: number;
  databaseConfidence: number;
  eventType: RoadEventType;
  disposition: DetectionDisposition;
  reasons: ConfidenceReason[];
  contributions: ScoreContribution[];
}

/** Exact deterministic Android detector-v2 port. */
export class HeuristicRoadEventDetector implements RoadEventDetector {
  private configuration: DetectorConfiguration;
  private frames: BoundedRingBuffer<ProcessedSample>;
  private readonly signalProcessor: SignalProcessor;
  private readonly baseline: AdaptiveRoadBaseline;
  private state = DetectorState.CALIBRATING;
  private diagnosticsListener: DetectorDiagnosticsListener | null = null;
  private triggerNanos = 0;
  private quietSinceNanos = 0;
  private settleUntilNanos = 0;
  private refractoryUntilNanos = 0;
  private lastTimestampNanos = 0;
  private lastReliableMovingNanos = 0;
  private candidateCounter = 0;

  constructor(
    configuration: DetectorConfiguration = detectorConfigurationForSensitivity(Sensitivity.BALANCED),
    private readonly featureExtractor = new FeatureExtractor()
  ) {
    this.configuration = configuration;
    this.frames = new BoundedRingBuffer(this.capacity);
    this.signalProcessor = new SignalProcessor(configuration);
    this.baseline = new AdaptiveRoadBaseline(configuration);
  }

  get detectorState(): DetectorState {
    return this.state;
  }

  get historySize(): number {
    return this.frames.size;
  }

  private get capacity(): number {
    return Math.max(
      200,
      Math.trunc(this.configuration.expectedSampleRateHz * this.configuration.historySeconds)
    );
  }

  updateConfiguration(configuration: DetectorConfiguration): void {
    const oldCapacity = this.capacity;
    const changed = !sameDetectorConfiguration(configuration, this.configuration);
    this.configuration = configuration;
    if (changed) this.signalProcessor.updateConfiguration(configuration);
    this.baseline.updateConfiguration(configuration);
    if (oldCapacity !== this.capacity) this.frames = new BoundedRingBuffer(this.capacity);
    this.cancelCandidate();
  }

  setDiagnosticsListener(listener: DetectorDiagnosticsListener | null): void {
    this.diagnosticsListener = listener;
  }

  addSample(
    sample: MotionSample,
    speedMetresPerSecond: number,
    locationQuality: LocationQuality,
    phoneStabilityScore: number,
    speedAccuracyMetresPerSecond = Number.NaN,
    bearingDegrees = Number.NaN
  ): DetectedRoadEvent | null {
    if (sample.elapsedRealtimeNanos <= this.lastTimestampNanos) return null;
    this.lastTimestampNanos = sample.elapsedRealtimeNanos;
    const aligned = this.alignToVehicle(sample, bearingDegrees);
    const safeSpeed =
      Number.isFinite(speedMetresPerSecond) && speedMetresPerSecond >= 0
        ? speedMetresPerSecond
        : Number.NaN;
    if (
      Number.isFinite(safeSpeed) &&
      safeSpeed >= this.configuration.minimumSpeedMetresPerSecond &&
      locationQuality !== LocationQuality.STALE &&
      locationQuality !== LocationQuality.UNAVAILABLE
    ) {
      this.lastReliableMovingNanos = sample.elapsedRealtimeNanos;
    }
    const frame = this.signalProcessor.process(aligned, {
      speedMetresPerSecond: safeSpeed,
      speedAccuracyMetresPerSecond,
      locationQuality,
      phoneStabilityScore
    });
    this.frames.add(frame);
    const candidateActive =
      this.state === DetectorState.CAPTURING || this.state === DetectorState.SETTLING;
    this.baseline.update(frame, candidateActive);
    const baselineNow = this.baseline.snapshot();
    if (
      this.state === DetectorState.CALIBRATING &&
      baselineNow.calibrationProgress >= 1
    ) {
      this.state = DetectorState.NORMAL;
    }

    const triggerThreshold = this.triggerThreshold(safeSpeed, baselineNow);
    const moving = this.isMoving(sample.elapsedRealtimeNanos, safeSpeed, locationQuality);
    const strongWithoutGps =
      (locationQuality === LocationQuality.STALE ||
        locationQuality === LocationQuality.UNAVAILABLE) &&
      Math.abs(frame.eventVertical) >=
        triggerThreshold * this.configuration.gpsDropoutStrongSignalMultiplier;
    const trigger =
      frame.envelope >= triggerThreshold &&
      Math.abs(frame.eventVertical) >=
        this.configuration.minimumPhysicalPeakMetresPerSecondSquared * 0.72;
    let result: DetectedRoadEvent | null = null;

    switch (this.state) {
      case DetectorState.CALIBRATING:
      case DetectorState.NORMAL:
        if (trigger && (moving || strongWithoutGps)) {
          this.beginCandidate(sample.elapsedRealtimeNanos);
        }
        break;
      case DetectorState.CAPTURING: {
        const elapsed = sample.elapsedRealtimeNanos - this.triggerNanos;
        const releaseThreshold = triggerThreshold * this.configuration.eventReleaseRatio;
        if (frame.envelope <= releaseThreshold) {
          if (this.quietSinceNanos === 0) this.quietSinceNanos = sample.elapsedRealtimeNanos;
        } else {
          this.quietSinceNanos = 0;
        }
        const quietLongEnough =
          this.quietSinceNanos !== 0 &&
          sample.elapsedRealtimeNanos - this.quietSinceNanos >=
            this.configuration.eventEndQuietMillis * 1_000_000;
        const minimumCaptured =
          elapsed >= this.configuration.minimumEventDurationMillis * 1_000_000;
        const maximumCaptured =
          elapsed >= this.configuration.maximumEventDurationMillis * 1_000_000;
        if ((quietLongEnough && minimumCaptured) || maximumCaptured) {
          this.state = DetectorState.SETTLING;
          this.settleUntilNanos =
            sample.elapsedRealtimeNanos + this.configuration.postEventWindowMillis * 1_000_000;
        }
        break;
      }
      case DetectorState.SETTLING:
        if (trigger && this.quietSinceNanos !== 0) {
          if (sample.elapsedRealtimeNanos - this.quietSinceNanos < 700_000_000) {
            this.state = DetectorState.CAPTURING;
            this.quietSinceNanos = 0;
          } else {
            result = this.finishCandidate(sample.elapsedRealtimeNanos, baselineNow, moving);
            if (moving || strongWithoutGps) this.beginCandidate(sample.elapsedRealtimeNanos);
          }
        } else if (sample.elapsedRealtimeNanos >= this.settleUntilNanos) {
          result = this.finishCandidate(sample.elapsedRealtimeNanos, baselineNow, moving);
        }
        break;
      case DetectorState.REFRACTORY:
        if (sample.elapsedRealtimeNanos >= this.refractoryUntilNanos) {
          this.state =
            baselineNow.calibrationProgress < 1 ? DetectorState.CALIBRATING : DetectorState.NORMAL;
          if (trigger && (moving || strongWithoutGps)) {
            this.beginCandidate(sample.elapsedRealtimeNanos);
          }
        }
        break;
      case DetectorState.SUPPRESSED:
        if (phoneStabilityScore >= 0.55 && frame.gyroMagnitude < 0.8) {
          this.state = DetectorState.NORMAL;
        }
        break;
    }

    this.diagnosticsListener?.onFrame?.({
      sample: aligned,
      speedMetresPerSecond: safeSpeed,
      speedAccuracyMetresPerSecond,
      locationQuality,
      phoneStabilityScore,
      eventVerticalAcceleration: frame.eventVertical,
      lowFrequencyVerticalAcceleration: frame.broadVertical,
      highFrequencyVerticalAcceleration: frame.highFrequencyVertical,
      verticalEnvelope: frame.envelope,
      verticalJerk: frame.verticalJerk,
      horizontalAcceleration: frame.horizontalBand,
      baselineVerticalRms: baselineNow.verticalRms,
      baselineHighFrequencyRms: baselineNow.highFrequencyRms,
      roadSurfaceState: baselineNow.surfaceState,
      detectorState: this.state
    });
    return result;
  }

  reset(): void {
    this.frames.clear();
    this.signalProcessor.reset();
    this.baseline.reset();
    this.lastTimestampNanos = 0;
    this.lastReliableMovingNanos = 0;
    this.candidateCounter = 0;
    this.cancelCandidate();
  }

  private beginCandidate(timestampNanos: number): void {
    this.triggerNanos = timestampNanos;
    this.quietSinceNanos = 0;
    this.state = DetectorState.CAPTURING;
  }

  private finishCandidate(
    nowNanos: number,
    baselineSnapshot: RoadBaselineSnapshot,
    movingAtEnd: boolean
  ): DetectedRoadEvent | null {
    this.candidateCounter += 1;
    const start =
      this.triggerNanos - this.configuration.preEventWindowMillis * 1_000_000;
    const window = this.frames.filter(
      (frame) =>
        frame.motion.elapsedRealtimeNanos >= start &&
        frame.motion.elapsedRealtimeNanos <= nowNanos
    );
    const features = this.featureExtractor.extractProcessed(
      window,
      baselineSnapshot,
      this.configuration
    );
    const scored: ScoredCandidate = features
      ? this.score(features, window, movingAtEnd)
      : {
          confidence: 0,
          databaseConfidence: 0,
          eventType: RoadEventType.UNKNOWN,
          disposition: DetectionDisposition.REJECTED,
          reasons: [ConfidenceReason.NO_PAIRED_SEQUENCE],
          contributions: [
            {
              name: 'feature extraction',
              value: -1,
              detail: 'insufficient coherent samples'
            }
          ]
        };
    const explanation = this.explanation(this.candidateCounter, features, scored);
    const evaluation: CandidateEvaluation = {
      candidateNumber: this.candidateCounter,
      detectorState: this.state,
      eventType: scored.eventType,
      disposition: scored.disposition,
      confidence: scored.confidence,
      databaseConfidence: scored.databaseConfidence,
      features,
      contributions: scored.contributions,
      explanation
    };
    this.diagnosticsListener?.onCandidate?.(evaluation);
    this.state =
      scored.eventType === RoadEventType.PHONE_MOVEMENT
        ? DetectorState.SUPPRESSED
        : DetectorState.REFRACTORY;
    this.refractoryUntilNanos =
      nowNanos + this.configuration.sameEventRefractoryMillis * 1_000_000;
    this.triggerNanos = 0;
    this.quietSinceNanos = 0;
    this.settleUntilNanos = 0;
    if (!features || scored.disposition === DetectionDisposition.REJECTED) return null;
    return {
      eventType: scored.eventType,
      confidence: scored.confidence,
      features,
      confidenceReasons: [...new Set(scored.reasons)],
      profile: features.profile,
      disposition: scored.disposition,
      databaseConfidence: scored.databaseConfidence,
      scoreContributions: scored.contributions,
      explanation
    };
  }

  private score(
    features: EventFeatures,
    window: readonly ProcessedSample[],
    movingAtEnd: boolean
  ): ScoredCandidate {
    const weights = this.configuration.weights;
    const contributions: ScoreContribution[] = [];
    const reasons: ConfidenceReason[] = [];
    const evidence = (name: string, feature: number, weight: number, detail: string): void => {
      contributions.push({ name, value: clamp(feature, 0, 1) * weight, detail });
    };
    const penalty = (name: string, feature: number, weight: number, detail: string): void => {
      contributions.push({ name, value: -clamp(feature, 0, 1) * weight, detail });
    };

    const signalToNoiseScore = normalized(features.baselineNoiseRatio, 1.6, 6.5);
    const durationScore =
      features.durationMillis < this.configuration.minimumEventDurationMillis
        ? 0
        : features.durationMillis < 350
          ? normalized(
              features.durationMillis,
              this.configuration.minimumEventDurationMillis,
              350
            )
          : features.durationMillis <= 2_600
            ? 1
            : 1 -
              normalized(
                features.durationMillis,
                2_600,
                this.configuration.maximumEventDurationMillis
              );
    evidence(
      'vertical waveform',
      features.bumpWaveformScore,
      weights.waveform,
      `${features.profile}, ${features.prominentPeakCount} prominent peaks`
    );
    evidence(
      'event isolation',
      features.eventIsolation,
      weights.isolation,
      `pre=${this.format(features.preEventVerticalRms)}, post=${this.format(features.postEventVerticalRms)} m/s² RMS`
    );
    evidence(
      'vertical dominance',
      features.verticalDominance,
      weights.verticalDominance,
      'vertical/horizontal energy separation'
    );
    evidence(
      'adaptive SNR',
      signalToNoiseScore,
      weights.signalToNoise,
      `${this.format(features.baselineNoiseRatio)}× current baseline`
    );
    evidence('event duration', durationScore, weights.duration, `${features.durationMillis} ms`);
    evidence(
      'suspension settling',
      features.settlingScore,
      weights.settling,
      'post-event decay'
    );
    evidence(
      'whole-vehicle coherence',
      features.wholeVehicleCoherence,
      weights.wholeVehicleCoherence,
      'vertical body motion with limited rotation'
    );
    evidence(
      'sensor quality',
      features.signalQuality,
      weights.signalQuality,
      `${this.format(features.sampleRateHz)} Hz, dropped=${this.format(features.droppedSampleFraction)}`
    );
    evidence(
      'approach deceleration',
      features.brakingEvidence,
      weights.brakingContext,
      'context only; never a trigger'
    );
    evidence(
      'post acceleration',
      features.postAccelerationEvidence,
      weights.postAccelerationContext,
      'optional departure evidence'
    );

    penalty(
      'rough-road continuity',
      features.roughnessScore,
      weights.roughRoadPenalty,
      'high-frequency energy, peak density, and pre/post vibration'
    );
    penalty(
      'pothole shape',
      features.potholeLikelihood,
      weights.potholePenalty,
      'sharpness, width, lobe imbalance, and one-wheel motion'
    );
    penalty(
      'phone movement',
      features.phoneMovementLikelihood,
      weights.phoneMovementPenalty,
      'mount stability, orientation, gyro, and horizontal motion'
    );
    penalty(
      'turn/lane-change',
      features.turnLikelihood * (1 - features.verticalDominance),
      weights.turnPenalty,
      'lateral/yaw-dominated context'
    );
    penalty(
      'hill/ramp',
      features.hillOrRampLikelihood * (1 - features.bumpWaveformScore),
      weights.hillOrRampPenalty,
      'long sustained pitch-like motion'
    );
    penalty(
      'high-frequency vibration',
      normalized(features.highFrequencyRatio, 0.28, 0.72),
      weights.highFrequencyPenalty,
      'crack/roughness frequency band'
    );
    if (features.sensorSaturated) {
      penalty('sensor clipping', 1, weights.clippingPenalty, 'raw sensor exceeded physical range');
    }

    const validSpeeds = window
      .map((frame) => frame.speedMetresPerSecond)
      .filter(
        (speed) =>
          Number.isFinite(speed) && speed >= this.configuration.minimumSpeedMetresPerSecond
      );
    const recentMoving = validSpeeds.length > 0 || movingAtEnd;
    const lastFrame = window.at(-1);
    const locationQuality = lastFrame?.locationQuality ?? LocationQuality.UNAVAILABLE;
    const speedUncertain =
      locationQuality === LocationQuality.STALE ||
      locationQuality === LocationQuality.UNAVAILABLE ||
      (Number.isFinite(lastFrame?.speedAccuracyMetresPerSecond) &&
        lastFrame!.speedAccuracyMetresPerSecond >
          this.configuration.poorSpeedAccuracyMetresPerSecond);
    if (!recentMoving) {
      penalty('stationary/unknown motion', 1, 0.34, 'no reliable recent driving-speed evidence');
    }
    if (speedUncertain) {
      penalty(
        'speed uncertainty',
        1,
        0.02,
        'GPS is contextual, so only a small quality penalty applies'
      );
    }

    let confidence = clamp(
      contributions.reduce((total, contribution) => total + contribution.value, 0) +
        this.configuration.sensitivityScoreOffset,
      0,
      1
    );
    const opposingLobes =
      features.positiveVerticalPeak > 0 &&
      features.negativeVerticalPeak < 0 &&
      features.lobeBalance >= this.configuration.minimumOpposingLobeRatio &&
      features.peakGapMillis >= this.configuration.minimumPeakGapMillis &&
      features.peakGapMillis <= this.configuration.maximumPeakGapMillis;
    const smoothWideAlternative =
      features.durationMillis >= 520 &&
      features.lowFrequencyRms > 0.28 &&
      features.bumpWaveformScore >= this.configuration.minimumWaveformScore + 0.08 &&
      features.highFrequencyRatio < 0.46;
    let physicallyValid =
      (opposingLobes || smoothWideAlternative) &&
      features.bumpWaveformScore >= this.configuration.minimumWaveformScore;
    if (
      features.roughnessScore >= this.configuration.veryRoughRoadThreshold &&
      (features.bumpWaveformScore < this.configuration.roughRoadMinimumWaveformScore ||
        features.eventIsolation < 0.45)
    ) {
      physicallyValid = false;
    }
    if (
      features.potholeLikelihood >= this.configuration.strongPotholeLikelihood &&
      features.bumpWaveformScore < 0.8
    ) {
      physicallyValid = false;
    }
    if (
      features.phoneMovementLikelihood >= this.configuration.severePhoneMovementLikelihood &&
      features.wholeVehicleCoherence < 0.88
    ) {
      physicallyValid = false;
    }
    if (!recentMoving) physicallyValid = false;
    if (!physicallyValid) {
      confidence = Math.min(confidence, this.configuration.localCandidateThreshold - 0.01);
    }

    if (opposingLobes) reasons.push(ConfidenceReason.OPPOSING_VERTICAL_PEAKS);
    if (features.bumpWaveformScore >= 0.55) reasons.push(ConfidenceReason.STRUCTURED_WAVEFORM);
    if (features.eventIsolation >= 0.62) reasons.push(ConfidenceReason.ISOLATED_EVENT);
    if (features.verticalDominance >= 0.68) reasons.push(ConfidenceReason.VERTICAL_DOMINANT);
    if (features.settlingScore >= 0.55) reasons.push(ConfidenceReason.SUSPENSION_SETTLING);
    if (
      features.profile === BumpProfile.LONG_SMOOTH_HUMP ||
      features.profile === BumpProfile.FLAT_TOP_TABLE
    ) {
      reasons.push(ConfidenceReason.LONG_SMOOTH_PROFILE);
    } else if (
      features.profile === BumpProfile.DOUBLE_AXLE ||
      features.profile === BumpProfile.CONSECUTIVE
    ) {
      reasons.push(ConfidenceReason.DOUBLE_AXLE_PROFILE);
    } else if (features.profile === BumpProfile.LOW_PROFILE) {
      reasons.push(ConfidenceReason.LOW_PROFILE_EVENT);
    }
    if (features.brakingEvidence >= 0.35) reasons.push(ConfidenceReason.VEHICLE_SLOWED);
    if (features.postAccelerationEvidence >= 0.35) {
      reasons.push(ConfidenceReason.POST_EVENT_ACCELERATION);
    }
    if (features.roughnessScore >= 0.45) reasons.push(ConfidenceReason.ROUGH_ROAD_CONTEXT);
    if (features.highFrequencyRatio >= 0.42) {
      reasons.push(ConfidenceReason.HIGH_FREQUENCY_VIBRATION);
    }
    if (features.potholeLikelihood >= 0.5) reasons.push(ConfidenceReason.POTHOLE_LIKE_IMPULSE);
    if (features.phoneMovementLikelihood >= 0.5) {
      reasons.push(ConfidenceReason.PHONE_MOVEMENT_LIKELY);
    }
    if (features.turnLikelihood >= 0.55) reasons.push(ConfidenceReason.TURNING_CONTEXT);
    if (features.hillOrRampLikelihood >= 0.55) {
      reasons.push(ConfidenceReason.HILL_OR_RAMP_LIKELY);
    }
    if (speedUncertain) reasons.push(ConfidenceReason.SPEED_CONTEXT_UNCERTAIN);
    if (features.signalQuality < 0.72) reasons.push(ConfidenceReason.SENSOR_QUALITY_REDUCED);
    if (features.sensorSaturated) reasons.push(ConfidenceReason.SENSOR_CLIPPING);

    const databaseConfidence = clamp(
      confidence * 0.82 +
        features.eventIsolation * 0.08 +
        features.signalQuality * 0.06 +
        features.wholeVehicleCoherence * 0.04 -
        (speedUncertain ? 0.035 : 0),
      0,
      1
    );
    const disposition =
      !physicallyValid || confidence < this.configuration.localCandidateThreshold
        ? DetectionDisposition.REJECTED
        : databaseConfidence >= this.configuration.databaseWorthyThreshold
          ? DetectionDisposition.DATABASE_WORTHY
          : DetectionDisposition.LOCAL_CANDIDATE;
    const eventType =
      disposition !== DetectionDisposition.REJECTED &&
      confidence >= this.configuration.probableThreshold
        ? RoadEventType.LIKELY_SPEED_BUMP
        : disposition !== DetectionDisposition.REJECTED
          ? RoadEventType.POSSIBLE_SPEED_BUMP
          : features.phoneMovementLikelihood >=
              Math.max(features.potholeLikelihood, features.roughnessScore)
            ? RoadEventType.PHONE_MOVEMENT
            : features.potholeLikelihood >= features.roughnessScore
              ? RoadEventType.POTHOLE_LIKE
              : features.roughnessScore >= 0.45
                ? RoadEventType.ROUGH_ROAD
                : RoadEventType.UNKNOWN;
    return {
      confidence,
      databaseConfidence,
      eventType,
      disposition,
      reasons,
      contributions
    };
  }

  private triggerThreshold(speed: number, baseline: RoadBaselineSnapshot): number {
    const speedScale = !Number.isFinite(speed)
      ? 1.1
      : speed < 2
        ? 0.76
        : speed < 4
          ? 0.88
          : speed <= 15
            ? 1
            : speed <= 25
              ? 1.1
              : 1.18;
    const roughScale =
      baseline.surfaceState === RoadSurfaceState.SMOOTH
        ? 0.92
        : baseline.surfaceState === RoadSurfaceState.NORMAL
          ? 1
          : baseline.surfaceState === RoadSurfaceState.ROUGH
            ? 1.16
            : 1.3;
    return (
      Math.max(
        this.configuration.minimumPhysicalPeakMetresPerSecondSquared,
        baseline.verticalRms * this.configuration.candidateSignalToNoiseRatio
      ) *
      speedScale *
      roughScale
    );
  }

  private isMoving(timestampNanos: number, speed: number, quality: LocationQuality): boolean {
    if (Number.isFinite(speed) && speed >= this.configuration.minimumSpeedMetresPerSecond) {
      return true;
    }
    return (
      (quality === LocationQuality.STALE || quality === LocationQuality.UNAVAILABLE) &&
      this.lastReliableMovingNanos !== 0 &&
      timestampNanos - this.lastReliableMovingNanos <=
        this.configuration.recentMovingMemoryMillis * 1_000_000
    );
  }

  private alignToVehicle(sample: MotionSample, bearingDegrees: number): MotionSample {
    if (
      !Number.isFinite(bearingDegrees) ||
      !Number.isFinite(sample.worldAccelerationEast) ||
      !Number.isFinite(sample.worldAccelerationNorth)
    ) {
      return sample;
    }
    const radians = (bearingDegrees * Math.PI) / 180;
    const forwardEast = Math.sin(radians);
    const forwardNorth = Math.cos(radians);
    return {
      ...sample,
      longitudinalAcceleration:
        sample.worldAccelerationEast * forwardEast +
        sample.worldAccelerationNorth * forwardNorth,
      lateralAcceleration:
        sample.worldAccelerationEast * forwardNorth -
        sample.worldAccelerationNorth * forwardEast
    };
  }

  private explanation(
    candidateNumber: number,
    features: EventFeatures | null,
    scored: ScoredCandidate
  ): string {
    const lines = [`Candidate #${candidateNumber}`];
    if (features) {
      lines.push(`Profile: ${features.profile}`, `Road: ${features.roadSurfaceState}`);
    }
    scored.contributions.forEach((contribution) => {
      const sign = contribution.value >= 0 ? '+' : '';
      lines.push(
        `${contribution.name}: ${sign}${this.format(contribution.value)} (${contribution.detail})`
      );
    });
    lines.push(
      `Final confidence: ${this.format(scored.confidence)}`,
      `Database confidence: ${this.format(scored.databaseConfidence)}`,
      `Classification: ${scored.eventType} / ${scored.disposition}`
    );
    return lines.join('\n');
  }

  private cancelCandidate(): void {
    this.triggerNanos = 0;
    this.quietSinceNanos = 0;
    this.settleUntilNanos = 0;
    this.refractoryUntilNanos = 0;
    this.state = DetectorState.CALIBRATING;
  }

  private format(value: number): string {
    return value.toFixed(3);
  }
}
