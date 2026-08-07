import { describe, expect, it } from 'vitest';
import type { GeoPoint } from '../../src/core/models';
import { Sensitivity } from '../../src/core/models';
import {
  AdaptiveRoadBaseline,
  BoundedRingBuffer,
  EventLocationEstimator,
  FeatureExtractor,
  LocationQuality,
  MedianOfThree,
  OrientationEstimator,
  SignalProcessor,
  TimedLowPass,
  browserRotationRateToRadians,
  createMotionSample,
  detectorConfigurationForSensitivity,
  rotationMatrixFromDeviceOrientation,
  toMlFeatureVector
} from '../../src/core/detector';
import { normalBump, runSyntheticScenario } from '../../src/testing/detectorScenarios';

describe('bounded ring buffer', () => {
  it('keeps insertion order and discards only the oldest value', () => {
    const buffer = new BoundedRingBuffer<number>(3);
    buffer.add(1);
    buffer.add(2);
    buffer.add(3);
    buffer.add(4);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
    expect(buffer.firstOrUndefined()).toBe(2);
    expect(buffer.lastOrUndefined()).toBe(4);
    buffer.clear();
    expect(buffer.isEmpty()).toBe(true);
  });

  it('rejects invalid capacities', () => {
    expect(() => new BoundedRingBuffer(0)).toThrow(RangeError);
    expect(() => new BoundedRingBuffer(2.5)).toThrow(RangeError);
  });
});

describe('timestamp-aware signal primitives', () => {
  it('matches Android median-of-three behavior', () => {
    const median = new MedianOfThree();
    expect([1, 100, 2, 3].map((value) => median.update(value))).toEqual([1, 50.5, 2, 3]);
  });

  it('uses elapsed timestamp rather than an assumed callback rate', () => {
    const regular = new TimedLowPass(2);
    const irregular = new TimedLowPass(2);
    regular.update(0, 1_000_000_000);
    irregular.update(0, 1_000_000_000);
    const regularAt100ms = regular.update(1, 1_100_000_000);
    irregular.update(1, 1_040_000_000);
    const irregularAt100ms = irregular.update(1, 1_100_000_000);
    const rc = 1 / (2 * Math.PI * 2);
    expect(regularAt100ms).toBeCloseTo(0.1 / (rc + 0.1), 12);
    expect(irregularAt100ms).toBeGreaterThan(regularAt100ms);
  });

  it('marks a >180 ms gap and restarts bands without inventing jerk', () => {
    const processor = new SignalProcessor(detectorConfigurationForSensitivity(Sensitivity.BALANCED));
    const context = {
      speedMetresPerSecond: 7,
      speedAccuracyMetresPerSecond: 0.4,
      locationQuality: LocationQuality.GOOD,
      phoneStabilityScore: 1
    };
    processor.process(sample(1_000_000_000, 0), context);
    const frame = processor.process(sample(1_300_000_000, 5), context);
    expect(frame.sampleGap).toBe(true);
    expect(frame.verticalJerk).toBe(0);
  });

  it('completes the exact eight-second automatic baseline calibration', () => {
    const configuration = detectorConfigurationForSensitivity(Sensitivity.BALANCED);
    const processor = new SignalProcessor(configuration);
    const baseline = new AdaptiveRoadBaseline(configuration);
    const context = {
      speedMetresPerSecond: 7,
      speedAccuracyMetresPerSecond: 0.4,
      locationQuality: LocationQuality.GOOD,
      phoneStabilityScore: 1
    };
    for (let index = 0; index < 801; index += 1) {
      baseline.update(
        processor.process(sample(2_000_000_000 + index * 10_000_000, 0), context),
        false
      );
    }
    expect(baseline.snapshot().calibrationProgress).toBe(1);
    expect(baseline.snapshot().verticalRms).toBeGreaterThanOrEqual(0.1);
  });
});

describe('orientation normalization', () => {
  it('uses rotation matrices for earth-up gravity removal', () => {
    const estimator = new OrientationEstimator();
    estimator.updateRotationMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const transformed = estimator.transform(1, 2, 12.80665);
    expect(transformed.vertical).toBeCloseTo(3, 6);
    expect(transformed.worldEast).toBeCloseTo(1, 6);
    expect(transformed.worldNorth).toBeCloseTo(2, 6);
    expect(transformed.reliable).toBe(true);
  });

  it('falls back to the measured gravity vector', () => {
    const estimator = new OrientationEstimator();
    estimator.updateGravity(0, 9.80665, 0);
    const transformed = estimator.transform(3, 11.80665, 4);
    expect(transformed.vertical).toBeCloseTo(2, 5);
    expect(transformed.lateral).toBeCloseTo(5, 5);
    expect(transformed.reliable).toBe(false);
  });

  it('computes a true relative angular step', () => {
    const estimator = new OrientationEstimator();
    estimator.updateRotationMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    estimator.updateRotationMatrix([0, -1, 0, 1, 0, 0, 0, 0, 1]);
    expect(estimator.transform(0, 0, 9.80665).orientationChange).toBeCloseTo(Math.PI / 2, 6);
  });

  it('provides iOS unit and Euler-matrix helpers', () => {
    const rate = browserRotationRateToRadians({ alpha: 180, beta: 90, gamma: -90 });
    expect(rate).toEqual({ x: Math.PI / 2, y: -Math.PI / 2, z: Math.PI });
    expect(rotationMatrixFromDeviceOrientation(0, 0, 0).map(Math.abs)).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1
    ]);
  });
});

describe('event location estimator', () => {
  const estimator = new EventLocationEstimator();

  it('interpolates bracketing monotonic locations', () => {
    const estimate = estimator.estimate(2_000_000_000, [
      point(1_000_000_000, 24, 46),
      point(3_000_000_000, 26, 48)
    ]);
    expect(estimate.method).toBe('interpolated');
    expect(estimate.point?.latitude).toBeCloseTo(25, 8);
    expect(estimate.point?.longitude).toBeCloseTo(47, 8);
  });

  it('rejects a nearest location older than eight seconds', () => {
    const estimate = estimator.estimate(10_000_000_000, [point(1_000_000_000, 24, 46)]);
    expect(estimate.method).toBe('stale');
    expect(estimate.point).toBeNull();
  });

  it('projects a nearby one-sided fix using speed and bearing', () => {
    const estimate = estimator.estimate(2_000_000_000, [
      { ...point(1_000_000_000, 0, 0), speedMetresPerSecond: 10, bearingDegrees: 90 }
    ]);
    expect(estimate.method).toBe('projected');
    expect(estimate.correctionDistanceMetres).toBeCloseTo(10, 6);
    expect(estimate.point?.longitude).toBeGreaterThan(0);
  });
});

describe('feature vector and detector timing guards', () => {
  it('keeps the fixed 46-value ML vector', () => {
    const samples = Array.from({ length: 100 }, (_, index) => {
      const vertical = normalBump(index / 100, 0.4);
      return sample(5_000_000_000 + index * 10_000_000, vertical);
    });
    const features = new FeatureExtractor().extract(samples, 0.1);
    expect(features).not.toBeNull();
    expect(toMlFeatureVector(features!)).toHaveLength(46);
    expect(toMlFeatureVector(features!).every(Number.isFinite)).toBe(true);
  });

  it('reports timestamp gaps through diagnostics during real scenarios', () => {
    const detector = new SignalProcessor(
      detectorConfigurationForSensitivity(Sensitivity.BALANCED)
    );
    const context = {
      speedMetresPerSecond: 7,
      speedAccuracyMetresPerSecond: 0.4,
      locationQuality: LocationQuality.GOOD,
      phoneStabilityScore: 1
    };
    detector.process(sample(1_000_000_000, 0), context);
    const processed = detector.process(sample(1_190_000_001, 0), context);
    expect(processed.sampleGap).toBe(true);
  });

  it('still detects a timestamp-valid normal scenario', () => {
    expect(
      runSyntheticScenario({ frame: (time) => ({ vertical: normalBump(time, 3.2) }) })
    ).toHaveLength(1);
  });
});

function sample(timestamp: number, vertical: number) {
  return createMotionSample({
    elapsedRealtimeNanos: timestamp,
    epochMillis: 0,
    accelerationX: 0,
    accelerationY: 0,
    accelerationZ: 9.80665 + vertical,
    verticalAcceleration: vertical
  });
}

function point(timestamp: number, latitude: number, longitude: number): GeoPoint {
  return {
    latitude,
    longitude,
    accuracyMetres: 8,
    bearingDegrees: 0,
    speedMetresPerSecond: 5,
    elapsedRealtimeNanos: timestamp,
    epochMillis: timestamp / 1_000_000,
    speedAccuracyMetresPerSecond: 0.4
  };
}
