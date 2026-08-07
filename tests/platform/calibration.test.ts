import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMotionSample } from '../../src/core/detector';
import { BrowserCalibrationService } from '../../src/platform/calibration';
import {
  BrowserMotionProvider,
  type MotionFrame,
  type MotionListener,
  type MotionPermissionStatus
} from '../../src/platform/motion';

class CalibrationMotionProvider extends BrowserMotionProvider {
  permission: MotionPermissionStatus = 'granted';
  startResult = true;
  observer: MotionListener | null = null;
  stops = 0;

  override requestPermission(): Promise<MotionPermissionStatus> {
    return Promise.resolve(this.permission);
  }

  override start(listener: MotionListener): boolean {
    if (this.startResult) this.observer = listener;
    return this.startResult;
  }

  override stop(): void {
    this.observer = null;
    this.stops += 1;
  }

  emit(frame: MotionFrame): void {
    this.observer?.onMotion(frame);
  }
}

function frame(index: number): MotionFrame {
  const noise = index % 2 === 0 ? 0.04 : -0.04;
  return {
    sample: createMotionSample({
      elapsedRealtimeNanos: 1_000_000_000 + index * 20_000_000,
      epochMillis: index * 20,
      accelerationX: noise,
      accelerationY: 0,
      accelerationZ: 9.80665 + noise,
      verticalAcceleration: noise,
      gyroscopeX: noise * 0.1,
      gravityX: 0,
      gravityY: 0,
      gravityZ: 9.80665
    }),
    stabilityScore: 0.98
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('BrowserCalibrationService', () => {
  it('builds a stable timestamp-aware profile from a mounted-phone sample window', async () => {
    vi.useFakeTimers();
    const provider = new CalibrationMotionProvider();
    const service = new BrowserCalibrationService(provider);
    const calibration = service.calibrate(2_000);
    await Promise.resolve();
    for (let index = 0; index < 100; index += 1) provider.emit(frame(index));
    await vi.advanceTimersByTimeAsync(2_000);

    const profile = await calibration;
    expect(profile).toMatchObject({
      sampleCount: 100,
      algorithmVersion: 2
    });
    expect(profile.gravityZ).toBeCloseTo(9.80665, 4);
    expect(profile.samplingConsistency).toBeCloseTo(1, 6);
    expect(profile.accelerometerNoiseRms).toBeGreaterThan(0);
    expect(provider.stops).toBe(1);
  });

  it('rejects denied and unavailable permission states before listening', async () => {
    const denied = new CalibrationMotionProvider();
    denied.permission = 'denied';
    await expect(new BrowserCalibrationService(denied).calibrate()).rejects.toThrow('denied');

    const unavailable = new CalibrationMotionProvider();
    unavailable.permission = 'unavailable';
    await expect(new BrowserCalibrationService(unavailable).calibrate()).rejects.toThrow('unavailable');
  });

  it('stops the provider and rejects an insufficient sample window', async () => {
    vi.useFakeTimers();
    const provider = new CalibrationMotionProvider();
    const calibration = new BrowserCalibrationService(provider).calibrate(2_000);
    await Promise.resolve();
    for (let index = 0; index < 20; index += 1) provider.emit(frame(index));
    const rejected = expect(calibration).rejects.toThrow('enough stable samples');
    await vi.advanceTimersByTimeAsync(2_000);

    await rejected;
    expect(provider.stops).toBe(1);
  });

  it('reports a provider that cannot start after permission is granted', async () => {
    const provider = new CalibrationMotionProvider();
    provider.startResult = false;
    await expect(new BrowserCalibrationService(provider).calibrate()).rejects.toThrow('unavailable');
  });
});
