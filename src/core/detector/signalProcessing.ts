import type { DetectorConfiguration } from './configuration';
import { sameDetectorConfiguration } from './configuration';
import { clamp, finiteOrZero } from './math';
import type { MotionSample, ProcessedSample } from './types';
import { LocationQuality } from './types';

/** One-pole low pass whose coefficient follows the real sample timestamp interval. */
export class TimedLowPass {
  private value = 0;
  private lastTimestampNanos = 0;
  private initialized = false;

  constructor(private readonly cutoffHz: number) {}

  update(input: number, timestampNanos: number): number {
    if (!this.initialized || timestampNanos <= this.lastTimestampNanos) {
      this.value = input;
      this.initialized = true;
      this.lastTimestampNanos = timestampNanos;
      return this.value;
    }
    const dt = clamp((timestampNanos - this.lastTimestampNanos) / 1_000_000_000, 0.0005, 0.25);
    this.lastTimestampNanos = timestampNanos;
    const rc = 1 / (2 * Math.PI * Math.max(this.cutoffHz, 0.01));
    const alpha = dt / (rc + dt);
    this.value += alpha * (input - this.value);
    return this.value;
  }

  reset(): void {
    this.value = 0;
    this.lastTimestampNanos = 0;
    this.initialized = false;
  }
}

export class MedianOfThree {
  private first = 0;
  private second = 0;
  private count = 0;

  update(value: number): number {
    if (this.count === 0) {
      this.first = value;
      this.second = value;
      this.count = 1;
      return value;
    }
    if (this.count === 1) {
      this.second = value;
      this.count = 2;
      return (this.first + value) * 0.5;
    }
    const result = this.median(this.first, this.second, value);
    this.first = this.second;
    this.second = value;
    return result;
  }

  reset(): void {
    this.count = 0;
  }

  private median(a: number, b: number, c: number): number {
    if (a > b) return b > c ? b : a > c ? c : a;
    return a > c ? a : b > c ? c : b;
  }
}

export interface SignalContext {
  speedMetresPerSecond: number;
  speedAccuracyMetresPerSecond: number;
  locationQuality: LocationQuality;
  phoneStabilityScore: number;
}

/** Produces the exact complementary motion bands used by Android detector v2. */
export class SignalProcessor {
  private configuration: DetectorConfiguration;
  private readonly median = new MedianOfThree();
  private drift: TimedLowPass;
  private eventLow: TimedLowPass;
  private broadLow: TimedLowPass;
  private highSplitLow: TimedLowPass;
  private envelopeLow: TimedLowPass;
  private horizontalLow: TimedLowPass;
  private lastEventVertical = 0;
  private lastTimestampNanos = 0;

  constructor(configuration: DetectorConfiguration) {
    this.configuration = configuration;
    this.drift = new TimedLowPass(configuration.driftLowPassCutoffHz);
    this.eventLow = new TimedLowPass(configuration.eventLowPassCutoffHz);
    this.broadLow = new TimedLowPass(configuration.broadMotionLowPassCutoffHz);
    this.highSplitLow = new TimedLowPass(configuration.highFrequencySplitHz);
    this.envelopeLow = new TimedLowPass(configuration.envelopeLowPassCutoffHz);
    this.horizontalLow = new TimedLowPass(configuration.eventLowPassCutoffHz);
  }

  updateConfiguration(configuration: DetectorConfiguration): void {
    if (sameDetectorConfiguration(configuration, this.configuration)) return;
    this.configuration = configuration;
    this.reset();
    this.drift = new TimedLowPass(configuration.driftLowPassCutoffHz);
    this.eventLow = new TimedLowPass(configuration.eventLowPassCutoffHz);
    this.broadLow = new TimedLowPass(configuration.broadMotionLowPassCutoffHz);
    this.highSplitLow = new TimedLowPass(configuration.highFrequencySplitHz);
    this.envelopeLow = new TimedLowPass(configuration.envelopeLowPassCutoffHz);
    this.horizontalLow = new TimedLowPass(configuration.eventLowPassCutoffHz);
  }

  process(sample: MotionSample, context: SignalContext): ProcessedSample {
    const gap =
      this.lastTimestampNanos !== 0 &&
      sample.elapsedRealtimeNanos - this.lastTimestampNanos >
        this.configuration.maximumContinuousSampleGapMillis * 1_000_000;
    if (gap) this.resetFiltersOnly();

    const cleanVertical = this.median.update(finiteOrZero(sample.verticalAcceleration));
    const eventLowValue = this.eventLow.update(cleanVertical, sample.elapsedRealtimeNanos);
    const driftValue = this.drift.update(cleanVertical, sample.elapsedRealtimeNanos);
    const eventVertical = eventLowValue - driftValue;
    const broadVertical = this.broadLow.update(cleanVertical, sample.elapsedRealtimeNanos) - driftValue;
    const highFrequencyVertical =
      cleanVertical - this.highSplitLow.update(cleanVertical, sample.elapsedRealtimeNanos);
    const envelope = this.envelopeLow.update(Math.abs(eventVertical), sample.elapsedRealtimeNanos);
    const dt =
      this.lastTimestampNanos === 0
        ? 0
        : (sample.elapsedRealtimeNanos - this.lastTimestampNanos) / 1_000_000_000;
    const verticalJerk =
      dt >= 0.001 && dt <= 0.2 ? clamp((eventVertical - this.lastEventVertical) / dt, -300, 300) : 0;
    this.lastTimestampNanos = sample.elapsedRealtimeNanos;
    this.lastEventVertical = eventVertical;

    const horizontalMagnitude = Math.sqrt(
      sample.longitudinalAcceleration * sample.longitudinalAcceleration +
        sample.lateralAcceleration * sample.lateralAcceleration
    );
    const horizontalBand = this.horizontalLow.update(horizontalMagnitude, sample.elapsedRealtimeNanos);
    const gyroMagnitude = Math.sqrt(
      sample.gyroscopeX * sample.gyroscopeX +
        sample.gyroscopeY * sample.gyroscopeY +
        sample.gyroscopeZ * sample.gyroscopeZ
    );

    return {
      motion: sample,
      speedMetresPerSecond: context.speedMetresPerSecond,
      speedAccuracyMetresPerSecond: context.speedAccuracyMetresPerSecond,
      locationQuality: context.locationQuality,
      phoneStabilityScore: clamp(context.phoneStabilityScore, 0, 1),
      eventVertical,
      broadVertical,
      highFrequencyVertical,
      envelope,
      verticalJerk,
      horizontalBand,
      gyroMagnitude,
      sampleGap: gap
    };
  }

  reset(): void {
    this.resetFiltersOnly();
    this.lastTimestampNanos = 0;
  }

  private resetFiltersOnly(): void {
    this.median.reset();
    this.drift.reset();
    this.eventLow.reset();
    this.broadLow.reset();
    this.highSplitLow.reset();
    this.envelopeLow.reset();
    this.horizontalLow.reset();
    this.lastEventVertical = 0;
  }
}
