import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserMotionProvider, MotionNormalizer, motionMath } from '../../src/platform/motion';

function motionEvent(
  timeStamp: number,
  overrides: Partial<Pick<DeviceMotionEvent, 'acceleration' | 'accelerationIncludingGravity' | 'rotationRate'>> = {}
): DeviceMotionEvent {
  return {
    timeStamp,
    acceleration: { x: 0, y: 0, z: 1 },
    accelerationIncludingGravity: { x: 0, y: 0, z: 10.80665 },
    rotationRate: { alpha: 180, beta: 90, gamma: 0 },
    ...overrides
  } as unknown as DeviceMotionEvent;
}

function orientationEvent(alpha: number, beta = 0, gamma = 0): DeviceOrientationEvent {
  return { alpha, beta, gamma } as DeviceOrientationEvent;
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'DeviceMotionEvent');
  Reflect.deleteProperty(window, 'DeviceOrientationEvent');
});

describe('MotionNormalizer', () => {
  it('uses DOM monotonic timestamps and converts rotation degrees to radians', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_260);
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const frame = new MotionNormalizer().normalize(motionEvent(1_250));

    expect(frame).not.toBeNull();
    expect(frame!.sample.elapsedRealtimeNanos).toBe(1_250_000_000);
    expect(frame!.sample.epochMillis).toBe(9_990);
    expect(frame!.sample.gyroscopeX).toBeCloseTo(Math.PI / 2);
    expect(frame!.sample.gyroscopeZ).toBeCloseTo(Math.PI);
    expect(frame!.sample.linearAccelerationAvailable).toBe(true);
  });

  it('falls back to receipt time for unrelated timestamps and detects missing linear acceleration', () => {
    vi.spyOn(performance, 'now').mockReturnValue(2_500);
    vi.spyOn(Date, 'now').mockReturnValue(20_000);
    const frame = new MotionNormalizer().normalize(
      motionEvent(1_700_000_000_000, {
        acceleration: { x: null, y: null, z: null },
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.80665 },
        rotationRate: null
      })
    );

    expect(frame!.sample.elapsedRealtimeNanos).toBe(2_500_000_000);
    expect(frame!.sample.epochMillis).toBe(20_000);
    expect(frame!.sample.linearAccelerationAvailable).toBe(false);
    expect(frame!.sample.verticalAcceleration).toBeCloseTo(0, 6);
  });

  it('consumes each orientation transition once instead of repeating phone movement forever', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const normalizer = new MotionNormalizer();
    normalizer.updateOrientation(orientationEvent(0));
    normalizer.updateOrientation(orientationEvent(20));

    const first = normalizer.normalize(motionEvent(1_000));
    const second = normalizer.normalize(motionEvent(1_010));

    expect(first!.sample.orientationReliable).toBe(true);
    expect(first!.sample.orientationChangeRadians).toBeGreaterThan(0.3);
    expect(second!.sample.orientationChangeRadians).toBe(0);
  });

  it('returns null when Safari supplies no usable acceleration source', () => {
    const normalizer = new MotionNormalizer();
    expect(normalizer.normalize(motionEvent(1, {
      acceleration: null,
      accelerationIncludingGravity: null
    }))).toBeNull();
  });

  it('keeps rotation helpers finite at matrix rounding boundaries', () => {
    const identity = motionMath.deviceRotationMatrix(0, 0, 0, 0);
    expect(motionMath.rotationStep(identity, identity)).toBe(0);
    expect(motionMath.deviceRotationMatrix(0, 0, 0, 90)).toHaveLength(9);
  });
});

describe('BrowserMotionProvider permission and lifecycle', () => {
  it('requires the iOS motion grant but treats orientation as an optional enhancement', async () => {
    const motionPermission = vi.fn(() => Promise.resolve('granted' as const));
    const orientationPermission = vi.fn(() => Promise.reject(new Error('orientation denied')));
    Object.defineProperty(window, 'DeviceMotionEvent', {
      configurable: true,
      value: class extends Event { static requestPermission = motionPermission; }
    });
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      configurable: true,
      value: class extends Event { static requestPermission = orientationPermission; }
    });

    const provider = new BrowserMotionProvider();
    await expect(provider.requestPermission()).resolves.toBe('granted');
    expect(motionPermission).toHaveBeenCalledOnce();
    expect(orientationPermission).toHaveBeenCalledOnce();
  });

  it('reports denied and unavailable states cleanly', async () => {
    Object.defineProperty(window, 'DeviceMotionEvent', {
      configurable: true,
      value: class extends Event { static requestPermission = vi.fn(() => Promise.resolve('denied')); }
    });
    const denied = new BrowserMotionProvider();
    await expect(denied.requestPermission()).resolves.toBe('denied');

    Reflect.deleteProperty(window, 'DeviceMotionEvent');
    const unavailable = new BrowserMotionProvider();
    expect(unavailable.available).toBe(false);
    await expect(unavailable.requestPermission()).resolves.toBe('unavailable');
    expect(unavailable.start({ onMotion: vi.fn(), onError: vi.fn() })).toBe(false);
  });

  it('attaches passive listeners, emits normalized frames, and stops cleanly', () => {
    Object.defineProperty(window, 'DeviceMotionEvent', {
      configurable: true,
      value: class extends Event {}
    });
    const provider = new BrowserMotionProvider();
    const onMotion = vi.fn();
    expect(provider.start({ onMotion, onError: vi.fn() })).toBe(true);

    const event = new Event('devicemotion');
    Object.defineProperties(event, {
      acceleration: { value: { x: 0, y: 0, z: 1 } },
      accelerationIncludingGravity: { value: { x: 0, y: 0, z: 10.8 } },
      rotationRate: { value: null }
    });
    window.dispatchEvent(event);
    expect(onMotion).toHaveBeenCalledOnce();

    provider.stop();
    window.dispatchEvent(event);
    expect(onMotion).toHaveBeenCalledOnce();
  });
});
