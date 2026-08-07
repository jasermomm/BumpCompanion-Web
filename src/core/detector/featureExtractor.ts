import type { DetectorConfiguration } from './configuration';
import { createDetectorConfiguration } from './configuration';
import type { RoadBaselineSnapshot } from './adaptiveRoadBaseline';
import { gaussianScore, normalized, clamp } from './math';
import type { EventFeatures, MotionSample, ProcessedSample } from './types';
import { BumpProfile, LocationQuality, RoadSurfaceState } from './types';

interface Peak {
  index: number;
  value: number;
  timestampNanos: number;
}

/** Complete pre/event/post feature extraction used only after an event candidate. */
export class FeatureExtractor {
  /** Compatibility entry point for focused tests and offline tooling. */
  extract(samples: readonly MotionSample[], baselineNoise: number): EventFeatures | null {
    if (samples.length < 8) return null;
    let previous = samples[0];
    const processed = samples.map((sample): ProcessedSample => {
      const dt = (sample.elapsedRealtimeNanos - previous.elapsedRealtimeNanos) / 1_000_000_000;
      const verticalJerk =
        dt > 0 ? (sample.verticalAcceleration - previous.verticalAcceleration) / dt : 0;
      previous = sample;
      return {
        motion: sample,
        speedMetresPerSecond: Number.NaN,
        speedAccuracyMetresPerSecond: Number.NaN,
        locationQuality: LocationQuality.UNAVAILABLE,
        phoneStabilityScore: 1,
        eventVertical: sample.verticalAcceleration,
        broadVertical: sample.verticalAcceleration,
        highFrequencyVertical: 0,
        envelope: Math.abs(sample.verticalAcceleration),
        verticalJerk,
        horizontalBand: Math.sqrt(
          sample.longitudinalAcceleration * sample.longitudinalAcceleration +
            sample.lateralAcceleration * sample.lateralAcceleration
        ),
        gyroMagnitude: Math.sqrt(
          sample.gyroscopeX * sample.gyroscopeX +
            sample.gyroscopeY * sample.gyroscopeY +
            sample.gyroscopeZ * sample.gyroscopeZ
        ),
        sampleGap: false
      };
    });
    const baseline: RoadBaselineSnapshot = {
      verticalRms: Math.max(baselineNoise, 0.05),
      horizontalRms: 0.1,
      jerkRms: 1,
      highFrequencyRms: 0.05,
      roughnessScore: 0,
      surfaceState: RoadSurfaceState.NORMAL,
      calibrationProgress: 1
    };
    return this.extractProcessed(processed, baseline, createDetectorConfiguration());
  }

  extractProcessed(
    samples: readonly ProcessedSample[],
    baseline: RoadBaselineSnapshot,
    configuration: DetectorConfiguration
  ): EventFeatures | null {
    if (samples.length < 8) return null;
    const activityThreshold = Math.max(
      configuration.minimumPhysicalPeakMetresPerSecondSquared * 0.35,
      baseline.verticalRms * 1.55
    );
    const activeIndices: number[] = [];
    samples.forEach((sample, index) => {
      if (Math.abs(sample.eventVertical) >= activityThreshold) activeIndices.push(index);
    });
    if (activeIndices.length === 0) return null;
    const activeStart = Math.max(0, activeIndices[0] - 2);
    const activeEnd = Math.min(samples.length - 1, activeIndices.at(-1)! + 2);
    const event = samples.slice(activeStart, activeEnd + 1);
    const pre = samples.slice(0, activeStart);
    const post = activeEnd < samples.length - 1 ? samples.slice(activeEnd + 1) : [];

    const positive = event.reduce((best, sample) =>
      sample.eventVertical > best.eventVertical ? sample : best
    );
    const negative = event.reduce((best, sample) =>
      sample.eventVertical < best.eventVertical ? sample : best
    );
    const positivePeak = positive.eventVertical;
    const negativePeak = negative.eventVertical;
    const peakToPeak = positivePeak - negativePeak;
    const eventTime =
      Math.abs(positivePeak) >= Math.abs(negativePeak)
        ? positive.motion.elapsedRealtimeNanos
        : negative.motion.elapsedRealtimeNanos;
    const peakGapMillis = Math.trunc(
      Math.abs(positive.motion.elapsedRealtimeNanos - negative.motion.elapsedRealtimeNanos) / 1_000_000
    );
    const durationMillis = Math.trunc(
      (event.at(-1)!.motion.elapsedRealtimeNanos - event[0].motion.elapsedRealtimeNanos) / 1_000_000
    );

    const verticalRms = this.rms(event, (sample) => sample.eventVertical);
    const horizontalRms = this.dynamicLateralRms(event);
    const jerkRms = this.rms(event, (sample) => sample.verticalJerk);
    const highFrequencyRms = this.rms(event, (sample) => sample.highFrequencyVertical);
    const lowFrequencyRms = this.rms(event, (sample) => sample.broadVertical);
    const gyroscopeRms = this.rms(event, (sample) => sample.gyroMagnitude);
    const jerkPeak = Math.max(...event.map((sample) => Math.abs(sample.verticalJerk)));
    const verticalEnergy = event.reduce(
      (total, sample) => total + sample.eventVertical * sample.eventVertical,
      0
    );
    const lateralEnergy =
      event.reduce(
        (total, sample) =>
          total + sample.motion.lateralAcceleration * sample.motion.lateralAcceleration,
        0
      ) / event.length;
    const gyroscopeEnergy =
      event.reduce((total, sample) => total + sample.gyroMagnitude * sample.gyroMagnitude, 0) /
      event.length;
    const orientationMean =
      event.reduce((total, sample) => total + sample.motion.orientationChangeRadians, 0) /
      event.length;
    const orientationVariance =
      event.reduce((total, sample) => {
        const delta = sample.motion.orientationChangeRadians - orientationMean;
        return total + delta * delta;
      }, 0) / event.length;
    const orientationMaximum = Math.max(
      ...event.map((sample) => Math.abs(sample.motion.orientationChangeRadians))
    );

    const peakThreshold = Math.max(
      activityThreshold,
      Math.max(Math.abs(positivePeak), Math.abs(negativePeak)) * 0.24
    );
    const peaks = this.localPeaks(event, peakThreshold, configuration.minimumPeakGapMillis);
    const coherentPairCount = this.coherentPairCount(peaks, configuration);
    const zeroCrossingCount = this.zeroCrossings(event, activityThreshold * 0.3);
    const dominantPeakWidthMillis = this.dominantPeakWidthMillis(event);
    const preEventVerticalRms =
      pre.length === 0 ? baseline.verticalRms : this.rms(pre, (sample) => sample.eventVertical);
    const postEventVerticalRms =
      post.length === 0 ? baseline.verticalRms : this.rms(post, (sample) => sample.eventVertical);
    const contextRms = Math.max(preEventVerticalRms, postEventVerticalRms);
    const eventIsolation = clamp(
      0.72 * normalized(verticalRms / Math.max(contextRms, 0.06), 1.45, 5.5) +
        0.28 *
          (1 -
            normalized(
              contextRms,
              baseline.verticalRms * 1.7,
              baseline.verticalRms * 4.2 + 0.2
            )),
      0,
      1
    );
    const verticalDominance = clamp(
      (verticalRms * verticalRms) /
        (verticalRms * verticalRms + horizontalRms * horizontalRms + 0.01),
      0,
      1
    );
    const lobeBalance =
      Math.min(Math.abs(positivePeak), Math.abs(negativePeak)) /
      Math.max(Math.abs(positivePeak), Math.abs(negativePeak), 0.05);
    const riseDuration = Math.max(
      1,
      Math.abs(eventTime - event[0].motion.elapsedRealtimeNanos)
    );
    const fallDuration = Math.max(
      1,
      Math.abs(event.at(-1)!.motion.elapsedRealtimeNanos - eventTime)
    );
    const waveformSymmetry = Math.min(riseDuration, fallDuration) / Math.max(riseDuration, fallDuration);
    const highFrequencyRatio = highFrequencyRms / (highFrequencyRms + verticalRms + 0.05);
    let postDecay = 0.5;
    if (post.length >= 4) {
      const half = Math.floor(post.length / 2);
      const early = this.rms(post.slice(0, Math.max(half, 1)), (sample) => sample.eventVertical);
      const late = this.rms(
        post.slice(Math.min(half, post.length - 1)),
        (sample) => sample.eventVertical
      );
      postDecay = normalized(
        early - late,
        -baseline.verticalRms,
        baseline.verticalRms * 2 + 0.15
      );
    }
    const settlingScore = clamp(
      0.58 *
        (1 - normalized(postEventVerticalRms / Math.max(baseline.verticalRms, 0.08), 1.2, 4)) +
        0.42 * postDecay,
      0,
      1
    );
    const gyroCoherence = 1 - normalized(gyroscopeRms, 0.35, 2.2);
    const wholeVehicleCoherence = clamp(
      0.66 * verticalDominance + 0.2 * gyroCoherence + 0.14 * lobeBalance,
      0,
      1
    );
    const approximateVerticalDisplacementMetres = this.approximateDisplacement(event);

    const preSpeed = this.medianFinite(
      pre.slice(-Math.max(1, Math.floor(pre.length / 2))).map((sample) => sample.speedMetresPerSecond)
    );
    const eventSpeeds = event
      .map((sample) => sample.speedMetresPerSecond)
      .filter((speed) => Number.isFinite(speed) && speed >= 0);
    const minimumEventSpeedMetresPerSecond =
      eventSpeeds.length > 0 ? Math.min(...eventSpeeds) : Number.NaN;
    const postSpeed = this.medianFinite(
      post
        .slice(0, Math.max(1, Math.floor(post.length / 2)))
        .map((sample) => sample.speedMetresPerSecond)
    );
    const absoluteSpeedReductionMetresPerSecond =
      Number.isFinite(preSpeed) && Number.isFinite(minimumEventSpeedMetresPerSecond)
        ? Math.max(0, preSpeed - minimumEventSpeedMetresPerSecond)
        : 0;
    const relativeSpeedReduction =
      Number.isFinite(preSpeed) && preSpeed > 0.8
        ? absoluteSpeedReductionMetresPerSecond / preSpeed
        : 0;
    const beforeLongitudinal = this.mean(
      pre.slice(-Math.max(1, Math.floor(pre.length / 2))),
      (sample) => sample.motion.longitudinalAcceleration
    );
    const duringLongitudinal = this.mean(event, (sample) => sample.motion.longitudinalAcceleration);
    const afterLongitudinal = this.mean(
      post.slice(0, Math.max(1, Math.floor(post.length / 2))),
      (sample) => sample.motion.longitudinalAcceleration
    );
    const decelerationRateMetresPerSecondSquared = Math.min(
      beforeLongitudinal,
      duringLongitudinal
    );
    const accelerationRateMetresPerSecondSquared = Math.max(0, afterLongitudinal);
    const brakingEvidence = Math.max(
      normalized(-decelerationRateMetresPerSecondSquared, 0.2, 2.2),
      normalized(absoluteSpeedReductionMetresPerSecond, 0.4, 4),
      normalized(relativeSpeedReduction, 0.06, 0.38)
    );
    const postAccelerationEvidence = Math.max(
      normalized(accelerationRateMetresPerSecondSquared, 0.15, 1.8),
      Number.isFinite(postSpeed) && Number.isFinite(minimumEventSpeedMetresPerSecond)
        ? normalized(postSpeed - minimumEventSpeedMetresPerSecond, 0.3, 3)
        : 0
    );

    const intervalsMillis = samples
      .slice(1)
      .map(
        (sample, index) =>
          (sample.motion.elapsedRealtimeNanos - samples[index].motion.elapsedRealtimeNanos) / 1_000_000
      )
      .filter((interval) => interval > 0);
    const calculatedMedianInterval = this.medianFinite(intervalsMillis);
    const medianInterval =
      Number.isFinite(calculatedMedianInterval) && calculatedMedianInterval > 0
        ? calculatedMedianInterval
        : 1_000 / configuration.expectedSampleRateHz;
    const sampleRateHz = 1_000 / medianInterval;
    const droppedFraction =
      samples.filter((sample) => sample.sampleGap).length / samples.length +
      intervalsMillis.filter((interval) => interval > medianInterval * 2.2).length /
        Math.max(1, intervalsMillis.length);
    const orientationReliability =
      samples.filter((sample) => sample.motion.orientationReliable).length / samples.length;
    const sampleRateQuality =
      1 - normalized(Math.abs(sampleRateHz - configuration.expectedSampleRateHz), 15, 70);
    const signalQuality = clamp(
      0.48 * sampleRateQuality +
        0.32 * (1 - clamp(droppedFraction, 0, 1)) +
        0.2 * (0.45 + 0.55 * orientationReliability),
      0,
      1
    );

    const peakDensity = peaks.length / Math.max(durationMillis / 1_000, 0.15);
    const sustainedContext = normalized(
      Math.max(preEventVerticalRms, postEventVerticalRms) / Math.max(baseline.verticalRms, 0.08),
      1.5,
      4
    );
    const roughnessScore = clamp(
      0.32 * baseline.roughnessScore +
        0.25 * highFrequencyRatio +
        0.23 * normalized(peakDensity, 4, 14) +
        0.2 * sustainedContext,
      0,
      1
    );

    const impulseSharpness = normalized(jerkPeak / Math.max(peakToPeak, 0.25), 11, 34);
    const narrowImpulse = 1 - normalized(dominantPeakWidthMillis, 65, 230);
    const singleSided = 1 - lobeBalance;
    const downFirst =
      negative.motion.elapsedRealtimeNanos < positive.motion.elapsedRealtimeNanos ? 1 : 0;
    const oneWheel = Math.max(
      1 - verticalDominance,
      normalized(gyroscopeRms, 0.35, 1.8)
    );
    const potholeLikelihood = clamp(
      0.29 * impulseSharpness +
        0.22 * narrowImpulse +
        0.17 * highFrequencyRatio +
        0.14 * singleSided +
        0.12 * oneWheel +
        0.06 * downFirst,
      0,
      1
    );

    const minimumStability = Math.min(...samples.map((sample) => sample.phoneStabilityScore));
    const sensorSaturated = this.isSaturated(samples, configuration);
    const phoneMovementLikelihood = clamp(
      0.36 * (1 - minimumStability) +
        0.25 *
          normalized(
            orientationMaximum,
            configuration.phoneOrientationStepRadians * 0.45,
            configuration.phoneOrientationStepRadians * 2.5
          ) +
        0.2 * normalized(gyroscopeRms, 0.55, 3) +
        0.14 * normalized(horizontalRms / Math.max(verticalRms, 0.1), 0.8, 2.5) +
        0.05 * (sensorSaturated ? 1 : 0),
      0,
      1
    );
    const lateralRms = this.rms(event, (sample) => sample.motion.lateralAcceleration);
    const yawRms = this.rms(event, (sample) => sample.motion.gyroscopeZ);
    const turnLikelihood = clamp(
      0.58 * normalized(lateralRms / Math.max(verticalRms, 0.1), 0.55, 1.8) +
        0.42 * normalized(yawRms, 0.2, 0.9),
      0,
      1
    );
    const broadRatio = lowFrequencyRms / Math.max(verticalRms, 0.05);
    const hillOrRampLikelihood = clamp(
      0.43 * normalized(durationMillis, 2_200, 5_000) +
        0.25 * normalized(broadRatio, 0.76, 1.05) +
        0.2 * normalized(orientationMaximum, 0.025, 0.14) +
        0.12 * (1 - lobeBalance),
      0,
      1
    );

    const profileScores = this.profileScores({
      peakToPeak,
      durationMillis,
      peakGapMillis,
      prominentPeakCount: peaks.length,
      coherentPairs: coherentPairCount,
      lobeBalance,
      isolation: eventIsolation,
      verticalDominance,
      highFrequencyRatio,
      broadRatio,
      baselineRatio: verticalRms / Math.max(baseline.verticalRms, 0.05),
      gyroscopeRms,
      configuration
    });
    const profileEntries = Object.entries(profileScores) as Array<[BumpProfile, number]>;
    const bestProfile = profileEntries.reduce(
      (best, entry) => (entry[1] > best[1] ? entry : best),
      profileEntries[0] ?? [BumpProfile.UNCLASSIFIED, 0]
    );

    return {
      eventElapsedRealtimeNanos: eventTime,
      positiveVerticalPeak: positivePeak,
      negativeVerticalPeak: negativePeak,
      peakToPeak,
      positivePeakTimeNanos: positive.motion.elapsedRealtimeNanos,
      negativePeakTimeNanos: negative.motion.elapsedRealtimeNanos,
      peakGapMillis,
      durationMillis,
      verticalRms,
      verticalEnergy,
      jerkPeak,
      longitudinalBefore: beforeLongitudinal,
      longitudinalDuring: duringLongitudinal,
      lateralEnergy,
      gyroscopeEnergy,
      orientationVariance,
      sensorSaturated,
      baselineNoiseRatio: verticalRms / Math.max(baseline.verticalRms, 0.05),
      horizontalRms,
      jerkRms,
      highFrequencyRms,
      highFrequencyRatio,
      lowFrequencyRms,
      zeroCrossingCount,
      prominentPeakCount: peaks.length,
      coherentPairCount,
      dominantPeakWidthMillis,
      eventIsolation,
      verticalDominance,
      waveformSymmetry,
      lobeBalance,
      settlingScore,
      wholeVehicleCoherence,
      approximateVerticalDisplacementMetres,
      preEventVerticalRms,
      postEventVerticalRms,
      preEventSpeedMetresPerSecond: preSpeed,
      minimumEventSpeedMetresPerSecond,
      postEventSpeedMetresPerSecond: postSpeed,
      absoluteSpeedReductionMetresPerSecond,
      relativeSpeedReduction,
      decelerationRateMetresPerSecondSquared,
      accelerationRateMetresPerSecondSquared,
      brakingEvidence,
      postAccelerationEvidence,
      gyroscopeRms,
      maximumOrientationStepRadians: orientationMaximum,
      orientationReliability,
      sampleRateHz,
      droppedSampleFraction: clamp(droppedFraction, 0, 1),
      signalQuality,
      roughnessScore,
      potholeLikelihood,
      phoneMovementLikelihood,
      turnLikelihood,
      hillOrRampLikelihood,
      bumpWaveformScore: bestProfile[1],
      profile: bestProfile[0],
      profileScores,
      roadSurfaceState: baseline.surfaceState
    };
  }

  private profileScores(input: {
    peakToPeak: number;
    durationMillis: number;
    peakGapMillis: number;
    prominentPeakCount: number;
    coherentPairs: number;
    lobeBalance: number;
    isolation: number;
    verticalDominance: number;
    highFrequencyRatio: number;
    broadRatio: number;
    baselineRatio: number;
    gyroscopeRms: number;
    configuration: DetectorConfiguration;
  }): Partial<Record<BumpProfile, number>> {
    const amplitude = normalized(
      input.peakToPeak,
      input.configuration.minimumPhysicalPeakMetresPerSecondSquared * 1.25,
      7.5
    );
    const gap =
      input.peakGapMillis < input.configuration.minimumPeakGapMillis
        ? 0
        : input.peakGapMillis <= 850
          ? 1
          : input.peakGapMillis <= input.configuration.maximumPeakGapMillis
            ? 1 -
              0.45 *
                normalized(
                  input.peakGapMillis,
                  850,
                  input.configuration.maximumPeakGapMillis
                )
            : 0;
    const pairQuality = clamp(
      0.31 * amplitude +
        0.25 * input.lobeBalance +
        0.19 * gap +
        0.15 * input.verticalDominance +
        0.1 * input.isolation,
      0,
      1
    );
    return {
      [BumpProfile.SHORT_SHARP]: clamp(
        pairQuality *
          gaussianScore(input.durationMillis, 620, 520) *
          (1 - input.highFrequencyRatio * 0.38),
        0,
        1
      ),
      [BumpProfile.LONG_SMOOTH_HUMP]: clamp(
        pairQuality *
          normalized(input.durationMillis, 520, 2_300) *
          (1 - input.highFrequencyRatio * 0.72) *
          normalized(input.broadRatio, 0.25, 0.82),
        0,
        1
      ),
      [BumpProfile.FLAT_TOP_TABLE]: clamp(
        pairQuality *
          normalized(input.durationMillis, 650, 2_400) *
          (1 - normalized(input.durationMillis, 3_200, 5_000)) *
          (0.72 + 0.28 * normalized(input.prominentPeakCount, 2, 5)),
        0,
        1
      ),
      [BumpProfile.LOW_PROFILE]: clamp(
        pairQuality *
          (1 - normalized(input.peakToPeak, 4.5, 9)) *
          normalized(input.baselineRatio, 1.8, 5) *
          (0.65 + 0.35 * input.isolation),
        0,
        1
      ),
      [BumpProfile.DOUBLE_AXLE]: clamp(
        pairQuality *
          normalized(input.coherentPairs, 1, 3) *
          normalized(input.prominentPeakCount, 3, 7),
        0,
        1
      ),
      [BumpProfile.ASYMMETRIC]: clamp(
        pairQuality *
          (0.68 + 0.32 * normalized(input.gyroscopeRms, 0.12, 0.75)) *
          (1 - normalized(input.gyroscopeRms, 1.2, 2.8)),
        0,
        1
      ),
      [BumpProfile.CONSECUTIVE]: clamp(
        pairQuality *
          normalized(input.coherentPairs, 1.5, 4) *
          normalized(input.durationMillis, 1_000, 3_600),
        0,
        1
      )
    };
  }

  private localPeaks(
    samples: readonly ProcessedSample[],
    threshold: number,
    minimumSpacingMillis: number
  ): Peak[] {
    const peaks: Peak[] = [];
    for (let index = 1; index < samples.length - 1; index += 1) {
      const value = samples[index].eventVertical;
      const isExtremum =
        (value >= samples[index - 1].eventVertical && value > samples[index + 1].eventVertical) ||
        (value <= samples[index - 1].eventVertical && value < samples[index + 1].eventVertical);
      if (!isExtremum || Math.abs(value) < threshold) continue;
      const previous = peaks.at(-1);
      const timestampNanos = samples[index].motion.elapsedRealtimeNanos;
      if (
        previous &&
        timestampNanos - previous.timestampNanos < minimumSpacingMillis * 1_000_000
      ) {
        if (Math.abs(value) > Math.abs(previous.value)) {
          peaks[peaks.length - 1] = { index, value, timestampNanos };
        }
      } else {
        peaks.push({ index, value, timestampNanos });
      }
    }
    return peaks;
  }

  private coherentPairCount(peaks: readonly Peak[], configuration: DetectorConfiguration): number {
    let pairs = 0;
    for (let index = 0; index < peaks.length - 1; index += 1) {
      const first = peaks[index];
      const second = peaks[index + 1];
      if (first.value * second.value >= 0) continue;
      const gap = Math.trunc((second.timestampNanos - first.timestampNanos) / 1_000_000);
      const balance =
        Math.min(Math.abs(first.value), Math.abs(second.value)) /
        Math.max(Math.abs(first.value), Math.abs(second.value), 0.05);
      if (
        gap >= configuration.minimumPeakGapMillis &&
        gap <= configuration.maximumPeakGapMillis &&
        balance >= configuration.minimumOpposingLobeRatio
      ) {
        pairs += 1;
      }
    }
    return pairs;
  }

  private zeroCrossings(samples: readonly ProcessedSample[], deadBand: number): number {
    let previousSign = 0;
    let count = 0;
    samples.forEach((sample) => {
      const sign = sample.eventVertical > deadBand ? 1 : sample.eventVertical < -deadBand ? -1 : 0;
      if (sign !== 0) {
        if (previousSign !== 0 && sign !== previousSign) count += 1;
        previousSign = sign;
      }
    });
    return count;
  }

  private dominantPeakWidthMillis(samples: readonly ProcessedSample[]): number {
    if (samples.length === 0) return 0;
    let index = 0;
    for (let candidate = 1; candidate < samples.length; candidate += 1) {
      if (Math.abs(samples[candidate].eventVertical) > Math.abs(samples[index].eventVertical)) {
        index = candidate;
      }
    }
    const threshold = Math.abs(samples[index].eventVertical) * 0.35;
    let left = index;
    let right = index;
    while (left > 0 && Math.abs(samples[left - 1].eventVertical) >= threshold) left -= 1;
    while (right < samples.length - 1 && Math.abs(samples[right + 1].eventVertical) >= threshold) {
      right += 1;
    }
    return Math.trunc(
      (samples[right].motion.elapsedRealtimeNanos - samples[left].motion.elapsedRealtimeNanos) /
        1_000_000
    );
  }

  private approximateDisplacement(samples: readonly ProcessedSample[]): number {
    if (samples.length < 3) return 0;
    const meanAcceleration =
      samples.reduce((total, sample) => total + sample.eventVertical, 0) / samples.length;
    let velocity = 0;
    let displacement = 0;
    let maximum = 0;
    for (let index = 1; index < samples.length; index += 1) {
      const dt = clamp(
        (samples[index].motion.elapsedRealtimeNanos -
          samples[index - 1].motion.elapsedRealtimeNanos) /
          1_000_000_000,
        0,
        0.1
      );
      const acceleration =
        (samples[index].eventVertical + samples[index - 1].eventVertical) * 0.5 -
        meanAcceleration;
      velocity += acceleration * dt;
      displacement += velocity * dt;
      maximum = Math.max(maximum, Math.abs(displacement));
    }
    return Math.min(maximum, 1.5);
  }

  private isSaturated(
    samples: readonly ProcessedSample[],
    configuration: DetectorConfiguration
  ): boolean {
    return samples.some(
      (sample) =>
        Math.abs(sample.motion.accelerationX) >
          configuration.sensorSaturationMetresPerSecondSquared ||
        Math.abs(sample.motion.accelerationY) >
          configuration.sensorSaturationMetresPerSecondSquared ||
        Math.abs(sample.motion.accelerationZ) >
          configuration.sensorSaturationMetresPerSecondSquared
    );
  }

  private rms(
    samples: readonly ProcessedSample[],
    selector: (sample: ProcessedSample) => number
  ): number {
    if (samples.length === 0) return 0;
    return Math.sqrt(
      samples.reduce((total, sample) => {
        const value = selector(sample);
        return total + value * value;
      }, 0) / samples.length
    );
  }

  private mean(
    samples: readonly ProcessedSample[],
    selector: (sample: ProcessedSample) => number
  ): number {
    if (samples.length === 0) return 0;
    return samples.reduce((total, sample) => total + selector(sample), 0) / samples.length;
  }

  private dynamicLateralRms(samples: readonly ProcessedSample[]): number {
    if (samples.length === 0) return 0;
    const lateralMean =
      samples.reduce((total, sample) => total + sample.motion.lateralAcceleration, 0) /
      samples.length;
    return Math.sqrt(
      samples.reduce((total, sample) => {
        const lateral = sample.motion.lateralAcceleration - lateralMean;
        return total + lateral * lateral;
      }, 0) / samples.length
    );
  }

  private medianFinite(values: readonly number[]): number {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length === 0) return Number.NaN;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) * 0.5 : sorted[middle];
  }
}
