import { describe, expect, it } from 'vitest';
import { LocationValidator } from '../../src/core/locationValidator';
import { makePoint } from './helpers';

describe('LocationValidator', () => {
  it('rejects invalid coordinates, negative accuracy, and impossible reported speed', () => {
    const validator = new LocationValidator();
    expect(validator.accept(makePoint({ latitude: 91 }))).toMatchObject({
      accepted: false,
      reason: 'invalid-coordinates'
    });
    expect(validator.accept(makePoint({ accuracyMetres: -1 }))).toMatchObject({
      accepted: false,
      reason: 'invalid-accuracy'
    });
    expect(validator.accept(makePoint({ speedMetresPerSecond: 66 }))).toMatchObject({
      accepted: false,
      reason: 'impossible-speed'
    });
  });

  it('derives missing speed and bearing from accepted timestamped fixes', () => {
    const validator = new LocationValidator();
    const first = validator.accept(
      makePoint({
        latitude: 30,
        speedMetresPerSecond: Number.NaN,
        bearingDegrees: Number.NaN,
        elapsedRealtimeNanos: 1_000_000_000
      })
    );
    expect(first.accepted).toBe(true);

    const second = validator.accept(
      makePoint({
        latitude: 30.0001,
        speedMetresPerSecond: Number.NaN,
        bearingDegrees: Number.NaN,
        elapsedRealtimeNanos: 2_000_000_000
      })
    );
    expect(second.accepted).toBe(true);
    expect(second.point!.speedMetresPerSecond).toBeGreaterThan(10);
    expect(second.point!.speedMetresPerSecond).toBeLessThan(12);
    expect(second.point!.bearingDegrees).toBeCloseTo(0, 1);
  });

  it('smooths speed as 65 percent previous plus 35 percent current', () => {
    const validator = new LocationValidator();
    validator.accept(makePoint({ speedMetresPerSecond: 10, elapsedRealtimeNanos: 1_000_000_000 }));
    const result = validator.accept(
      makePoint({
        latitude: 30.0001,
        speedMetresPerSecond: 20,
        elapsedRealtimeNanos: 2_000_000_000
      })
    );
    expect(result.point!.speedMetresPerSecond).toBeCloseTo(13.5, 8);
  });

  it('rejects implausible jumps and non-monotonic timestamps without poisoning state', () => {
    const validator = new LocationValidator();
    validator.accept(makePoint({ elapsedRealtimeNanos: 1_000_000_000 }));
    expect(
      validator.accept(
        makePoint({ latitude: 31, elapsedRealtimeNanos: 2_000_000_000, speedMetresPerSecond: 10 })
      )
    ).toMatchObject({ accepted: false, reason: 'implausible-jump' });
    expect(
      validator.accept(makePoint({ elapsedRealtimeNanos: 1_000_000_000 }))
    ).toMatchObject({ accepted: false, reason: 'non-monotonic-timestamp' });
    expect(
      validator.accept(
        makePoint({ latitude: 30.0001, elapsedRealtimeNanos: 2_000_000_000 })
      ).accepted
    ).toBe(true);
  });

  it('reset discards timing continuity', () => {
    const validator = new LocationValidator();
    validator.accept(makePoint());
    validator.reset();
    expect(
      validator.accept(
        makePoint({ latitude: 35, longitude: 40, elapsedRealtimeNanos: 1_000_000_000 })
      ).accepted
    ).toBe(true);
  });
});
