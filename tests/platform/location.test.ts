import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationQuality } from '../../src/core/models';
import { BrowserLocationProvider } from '../../src/platform/location';

interface FakeGeolocation {
  getCurrentPosition: ReturnType<typeof vi.fn>;
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
}

function position(
  timestamp: number,
  latitude = 30,
  longitude = 40,
  speed: number | null = 10,
  accuracy = 8
): GeolocationPosition {
  return {
    timestamp,
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: 20,
      speed,
      toJSON: () => ({})
    },
    toJSON: () => ({})
  };
}

function geoError(code: number): GeolocationPositionError {
  return {
    code,
    message: 'failure',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3
  };
}

function installGeolocation(overrides: Partial<FakeGeolocation> = {}): FakeGeolocation {
  const geolocation: FakeGeolocation = {
    getCurrentPosition: vi.fn(),
    watchPosition: vi.fn(() => 7),
    clearWatch: vi.fn(),
    ...overrides
  };
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: geolocation
  });
  return geolocation;
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'geolocation');
});

describe('BrowserLocationProvider', () => {
  it('maps permission success, denial, and provider failures', async () => {
    let success: PositionCallback | null = null;
    let failure: PositionErrorCallback | null = null;
    const geolocation = installGeolocation({
      getCurrentPosition: vi.fn((onSuccess: PositionCallback, onFailure: PositionErrorCallback) => {
        success = onSuccess;
        failure = onFailure;
      })
    });
    const provider = new BrowserLocationProvider();
    const granted = provider.requestPermission();
    success!(position(Date.now()));
    await expect(granted).resolves.toBe('granted');

    const denied = provider.requestPermission();
    failure!(geoError(1));
    await expect(denied).resolves.toBe('denied');

    const unavailable = provider.requestPermission();
    failure!(geoError(2));
    await expect(unavailable).resolves.toBe('unavailable');
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(3);
  });

  it('reports unavailable without touching browser APIs', async () => {
    Reflect.deleteProperty(navigator, 'geolocation');
    const provider = new BrowserLocationProvider();
    expect(provider.available).toBe(false);
    await expect(provider.requestPermission()).resolves.toBe('unavailable');
    expect(provider.start({ onLocation: vi.fn(), onError: vi.fn() })).toBe(false);
  });

  it('projects acquisition time onto the motion clock and classifies fix quality', () => {
    let onPosition: PositionCallback | null = null;
    installGeolocation({
      watchPosition: vi.fn((success: PositionCallback) => {
        onPosition = success;
        return 4;
      })
    });
    let epochNow = 10_000;
    let monotonicNow = 5_000;
    vi.spyOn(Date, 'now').mockImplementation(() => epochNow);
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
    const provider = new BrowserLocationProvider();
    const onLocation = vi.fn();
    provider.start({ onLocation, onError: vi.fn() });

    onPosition!(position(9_000));
    expect(onLocation).toHaveBeenCalledWith(
      expect.objectContaining({ epochMillis: 9_000, elapsedRealtimeNanos: 4_000_000_000 }),
      LocationQuality.GOOD
    );

    epochNow = 20_000;
    monotonicNow = 15_000;
    onPosition!(position(10_000, 30.00001, 40, 10, 20));
    expect(onLocation).toHaveBeenLastCalledWith(expect.anything(), LocationQuality.STALE);
  });

  it('rejects impossible GPS jumps without poisoning the last trusted fix', () => {
    let onPosition: PositionCallback | null = null;
    installGeolocation({
      watchPosition: vi.fn((success: PositionCallback) => {
        onPosition = success;
        return 8;
      })
    });
    let now = 1_000_000;
    let monotonic = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    const onLocation = vi.fn();
    const onError = vi.fn();
    const provider = new BrowserLocationProvider();
    provider.start({ onLocation, onError });

    onPosition!(position(now, 30, 40));
    now += 1_000;
    monotonic += 1_000;
    onPosition!(position(now, 35, 45));
    expect(onError).toHaveBeenCalledWith('An implausible location update was ignored.');
    expect(onLocation).toHaveBeenCalledTimes(1);

    now += 1_000;
    monotonic += 1_000;
    onPosition!(position(now, 30.0001, 40));
    expect(onLocation).toHaveBeenCalledTimes(2);
  });

  it('maps watch errors and resets trust state when stopped', () => {
    let onPosition: PositionCallback | null = null;
    let onWatchError: PositionErrorCallback | null = null;
    const geolocation = installGeolocation({
      watchPosition: vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
        onPosition = success;
        onWatchError = failure;
        return 12;
      })
    });
    const onLocation = vi.fn();
    const onError = vi.fn();
    const provider = new BrowserLocationProvider();
    expect(provider.start({ onLocation, onError })).toBe(true);
    onPosition!(position(1_000, 30, 40));
    onWatchError!(geoError(2));
    expect(onError).toHaveBeenLastCalledWith('Location is temporarily unavailable.');

    provider.stop();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(12);
    provider.start({ onLocation, onError });
    onPosition!(position(2_000, -20, -30));
    expect(onLocation).toHaveBeenCalledTimes(2);
  });

  it('returns false when watchPosition throws synchronously', () => {
    installGeolocation({ watchPosition: vi.fn(() => { throw new DOMException('blocked'); }) });
    const provider = new BrowserLocationProvider();
    expect(provider.start({ onLocation: vi.fn(), onError: vi.fn() })).toBe(false);
  });
});
