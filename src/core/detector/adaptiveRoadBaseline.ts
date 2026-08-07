import type { DetectorConfiguration } from './configuration';
import { clamp, normalized, square } from './math';
import type { ProcessedSample } from './types';
import { RoadSurfaceState } from './types';

export interface RoadBaselineSnapshot {
  verticalRms: number;
  horizontalRms: number;
  jerkRms: number;
  highFrequencyRms: number;
  roughnessScore: number;
  surfaceState: RoadSurfaceState;
  calibrationProgress: number;
}

/** Bounded asymmetric baseline learning from Android detector v2. */
export class AdaptiveRoadBaseline {
  private configuration: DetectorConfiguration;
  private verticalSquare: number;
  private horizontalSquare = square(0.12);
  private jerkSquare = square(2);
  private highFrequencySquare = square(0.08);
  private shortVerticalSquare: number;
  private shortHighFrequencySquare: number;
  private shortHorizontalSquare: number;
  private peakActivity = 0;
  private learnedSeconds = 0;
  private lastTimestampNanos = 0;

  constructor(configuration: DetectorConfiguration) {
    this.configuration = configuration;
    this.verticalSquare = square(configuration.initialBaselineVerticalRms);
    this.shortVerticalSquare = this.verticalSquare;
    this.shortHighFrequencySquare = this.highFrequencySquare;
    this.shortHorizontalSquare = this.horizontalSquare;
  }

  updateConfiguration(configuration: DetectorConfiguration): void {
    this.configuration = configuration;
    this.verticalSquare = clamp(
      this.verticalSquare,
      square(configuration.minimumBaselineVerticalRms),
      square(configuration.maximumBaselineVerticalRms)
    );
  }

  update(sample: ProcessedSample, candidateActive: boolean): void {
    const dt =
      this.lastTimestampNanos === 0
        ? 1 / this.configuration.expectedSampleRateHz
        : clamp((sample.motion.elapsedRealtimeNanos - this.lastTimestampNanos) / 1_000_000_000, 0, 0.2);
    this.lastTimestampNanos = sample.motion.elapsedRealtimeNanos;
    if (dt <= 0) return;

    const shortAlpha = 1 - Math.exp(-dt / 2);
    this.shortVerticalSquare += shortAlpha * (square(sample.eventVertical) - this.shortVerticalSquare);
    this.shortHighFrequencySquare +=
      shortAlpha * (square(sample.highFrequencyVertical) - this.shortHighFrequencySquare);
    this.shortHorizontalSquare += shortAlpha * (square(sample.horizontalBand) - this.shortHorizontalSquare);
    const currentVerticalRms = Math.max(
      Math.sqrt(this.verticalSquare),
      this.configuration.minimumBaselineVerticalRms
    );
    const isPeak = Math.abs(sample.eventVertical) > currentVerticalRms * 2.2 + 0.25 ? 1 : 0;
    this.peakActivity += shortAlpha * (isPeak - this.peakActivity);

    const isOutlier =
      Math.abs(sample.eventVertical) >
      currentVerticalRms * this.configuration.baselineOutlierSigma + 0.35;
    if (!candidateActive && !isOutlier && !sample.sampleGap) {
      const normalAlpha = 1 - Math.exp(-dt / this.configuration.baselineTimeConstantSeconds);
      this.verticalSquare = this.adaptSquare(this.verticalSquare, square(sample.eventVertical), normalAlpha);
      this.horizontalSquare = this.adaptSquare(
        this.horizontalSquare,
        square(sample.horizontalBand),
        normalAlpha
      );
      this.jerkSquare = this.adaptSquare(this.jerkSquare, square(sample.verticalJerk), normalAlpha);
      this.highFrequencySquare = this.adaptSquare(
        this.highFrequencySquare,
        square(sample.highFrequencyVertical),
        normalAlpha
      );
      this.verticalSquare = clamp(
        this.verticalSquare,
        square(this.configuration.minimumBaselineVerticalRms),
        square(this.configuration.maximumBaselineVerticalRms)
      );
      this.learnedSeconds = Math.min(
        this.configuration.automaticCalibrationSeconds,
        this.learnedSeconds + dt
      );
    }
  }

  snapshot(): RoadBaselineSnapshot {
    const verticalRms = clamp(
      Math.sqrt(this.verticalSquare),
      this.configuration.minimumBaselineVerticalRms,
      this.configuration.maximumBaselineVerticalRms
    );
    const shortVertical = Math.sqrt(Math.max(0, this.shortVerticalSquare));
    const shortHighFrequency = Math.sqrt(Math.max(0, this.shortHighFrequencySquare));
    const shortHorizontal = Math.sqrt(Math.max(0, this.shortHorizontalSquare));
    const elevatedBroadband = normalized(shortVertical / Math.max(verticalRms, 0.08), 1.35, 3.6);
    const highFrequency = normalized(
      shortHighFrequency / Math.max(Math.sqrt(this.highFrequencySquare), 0.05),
      1.4,
      4.5
    );
    const multiAxis = normalized(shortHorizontal / (shortVertical + 0.08), 0.55, 1.8);
    const density = normalized(this.peakActivity, 0.025, 0.2);
    const roughnessScore = clamp(
      0.34 * elevatedBroadband + 0.31 * highFrequency + 0.17 * multiAxis + 0.18 * density,
      0,
      1
    );
    const surfaceState =
      roughnessScore >= this.configuration.veryRoughRoadThreshold
        ? RoadSurfaceState.VERY_ROUGH
        : roughnessScore >= this.configuration.roughRoadThreshold
          ? RoadSurfaceState.ROUGH
          : roughnessScore < 0.22
            ? RoadSurfaceState.SMOOTH
            : RoadSurfaceState.NORMAL;
    return {
      verticalRms,
      horizontalRms: Math.sqrt(Math.max(0, this.horizontalSquare)),
      jerkRms: Math.sqrt(Math.max(0, this.jerkSquare)),
      highFrequencyRms: Math.sqrt(Math.max(0, this.highFrequencySquare)),
      roughnessScore,
      surfaceState,
      calibrationProgress: clamp(
        this.learnedSeconds / this.configuration.automaticCalibrationSeconds,
        0,
        1
      )
    };
  }

  reset(): void {
    this.verticalSquare = square(this.configuration.initialBaselineVerticalRms);
    this.horizontalSquare = square(0.12);
    this.jerkSquare = square(2);
    this.highFrequencySquare = square(0.08);
    this.shortVerticalSquare = this.verticalSquare;
    this.shortHighFrequencySquare = this.highFrequencySquare;
    this.shortHorizontalSquare = this.horizontalSquare;
    this.peakActivity = 0;
    this.learnedSeconds = 0;
    this.lastTimestampNanos = 0;
  }

  private adaptSquare(current: number, observed: number, alpha: number): number {
    const boundedObserved = Math.min(observed, current * 9 + 0.04);
    const rate = boundedObserved > current ? alpha * this.configuration.baselineRiseRateMultiplier : alpha;
    return current + rate * (boundedObserved - current);
  }
}
