import { describe, expect, it } from 'vitest';
import { ApproachPredictor, WarningPhase } from '../../src/core/approach';
import { GeoMath } from '../../src/core/geo';
import { Directionality } from '../../src/core/models';
import { makeBump, makePoint } from '../data/helpers';

describe('GeoMath', () => {
  it('computes distance, bearing, projection, and bounding boxes consistently', () => {
    const distance = GeoMath.distanceMetres(30, 31, 30.001, 31);
    expect(distance).toBeGreaterThan(110);
    expect(distance).toBeLessThan(112);
    expect(GeoMath.initialBearingDegrees(30, 31, 30.001, 31)).toBeCloseTo(0, 5);
    expect(GeoMath.smallestAngleDifference(350, 10)).toBe(20);
    const projected = GeoMath.project(30, 31, distance, 0);
    expect(projected.latitude).toBeCloseTo(30.001, 5);
    const box = GeoMath.boundingBox(30, 31, 100);
    expect(box.minLatitude).toBeLessThan(30);
    expect(box.maxLongitude).toBeGreaterThan(31);
  });
});

describe('ApproachPredictor', () => {
  it('increases adaptive warning distance with speed and poor accuracy', () => {
    const predictor = new ApproachPredictor();
    expect(predictor.adaptiveWarningDistance(20, 8)).toBeGreaterThan(
      predictor.adaptiveWarningDistance(3, 8)
    );
    expect(predictor.adaptiveWarningDistance(10, 50)).toBeGreaterThan(
      predictor.adaptiveWarningDistance(10, 8)
    );
  });

  it('warns once on a direct approach and detects the pass', () => {
    const predictor = new ApproachPredictor(60_000);
    const bump = makeBump({
      id: 'direct',
      latitude: 30.0444,
      longitude: 31.238,
      confidence: 0.95,
      coordinateConfidence: 0.95,
      directionality: Directionality.BIDIRECTIONAL
    });
    const decisions = Array.from({ length: 51 }, (_, index) =>
      predictor.update(
        makePoint({
          latitude: 30.0444,
          longitude: 31.234 + index * 0.0001,
          accuracyMetres: 7,
          bearingDegrees: 90,
          speedMetresPerSecond: 10,
          elapsedRealtimeNanos: index * 1_000_000_000,
          epochMillis: index * 1_000
        }),
        [bump],
        index * 1_000
      )
    );
    expect(decisions.filter((decision) => decision.type === 'warn')).toHaveLength(1);
    expect(decisions.some((decision) => decision.type === 'passed')).toBe(true);
  });

  it('does not warn for a parallel road', () => {
    const predictor = new ApproachPredictor();
    const bump = makeBump({
      id: 'parallel',
      latitude: 30.0453,
      longitude: 31.238,
      confidence: 0.95
    });
    const warnings = Array.from({ length: 46 }, (_, index) =>
      predictor.update(
        makePoint({
          latitude: 30.0444,
          longitude: 31.234 + index * 0.0001,
          accuracyMetres: 6,
          bearingDegrees: 90,
          speedMetresPerSecond: 11,
          elapsedRealtimeNanos: index * 1_000_000_000,
          epochMillis: index * 1_000
        }),
        [bump],
        index * 1_000
      )
    ).filter((decision) => decision.type === 'warn');
    expect(warnings).toHaveLength(0);
  });

  it('honours directionality, warning disablement, and immediate warning phase', () => {
    const wrongDirection = makeBump({
      id: 'one-way',
      latitude: 30.0005,
      longitude: 31,
      directionality: Directionality.ONE_DIRECTION,
      primaryBearing: 180,
      bearingTolerance: 20
    });
    const predictor = new ApproachPredictor();
    const wrongDirectionDecisions = [0, 0.0001, 0.0002, 0.0003].map((latitude, index) =>
      predictor.update(
        makePoint({
          latitude: 30 + latitude,
          bearingDegrees: 0,
          elapsedRealtimeNanos: (index + 1) * 1_000_000_000,
          epochMillis: (index + 1) * 1_000
        }),
        [wrongDirection],
        index * 1_000
      )
    );
    expect(wrongDirectionDecisions.every((decision) => decision.type === 'none')).toBe(true);

    const direct = makeBump({ id: 'close', latitude: 30.0003, longitude: 31 });
    const enabled = new ApproachPredictor();
    const enabledDecisions = [enabled.update(makePoint(), [direct], 0)];
    for (let index = 1; index <= 3; index += 1) {
      enabledDecisions.push(
        enabled.update(
          makePoint({
            latitude: 30 + index * 0.00008,
            elapsedRealtimeNanos: (index + 1) * 1_000_000_000,
            epochMillis: (index + 1) * 1_000
          }),
          [direct],
          index * 1_000
        )
      );
    }
    const warning = enabledDecisions.find((decision) => decision.type === 'warn');
    expect(warning?.type).toBe('warn');
    if (warning?.type === 'warn') expect(warning.phase).toBe(WarningPhase.IMMEDIATE);

    const disabled = new ApproachPredictor();
    let disabledDecision = disabled.update(makePoint(), [direct], 0, false);
    for (let index = 1; index <= 3; index += 1) {
      disabledDecision = disabled.update(
        makePoint({
          latitude: 30 + index * 0.00008,
          elapsedRealtimeNanos: (index + 1) * 1_000_000_000,
          epochMillis: (index + 1) * 1_000
        }),
        [direct],
        index * 1_000,
        false
      );
    }
    expect(disabledDecision.type).toBe('tracking');
  });
});
