import { LocationQuality, type GeoPoint } from '../core/models';
import { LocationValidator } from '../core/locationValidator';

export type LocationPermissionStatus = 'granted' | 'denied' | 'unavailable';

export interface LocationListener {
  onLocation(point: GeoPoint, quality: LocationQuality): void;
  onError(message: string): void;
}

function monotonicNowNanos(): number {
  return Math.round(performance.now() * 1_000_000);
}

function monotonicNanosForEpoch(epochMillis: number): number {
  if (!Number.isFinite(epochMillis) || epochMillis <= 0) return monotonicNowNanos();
  // Geolocation timestamps describe when the fix was acquired, while callbacks can
  // arrive later. Project that acquisition time onto the same monotonic clock used by
  // DeviceMotion so event/location interpolation is not biased by callback latency.
  const ageMillis = Math.max(0, Date.now() - epochMillis);
  return Math.round(Math.max(0, performance.now() - ageMillis) * 1_000_000);
}

export class BrowserLocationProvider {
  private watchId: number | null = null;
  private listener: LocationListener | null = null;
  private readonly validator = new LocationValidator();

  readonly available = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  async requestPermission(): Promise<LocationPermissionStatus> {
    if (!this.available) return 'unavailable';
    return await new Promise<LocationPermissionStatus>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve('granted'),
        (error) => resolve(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
      );
    });
  }

  start(listener: LocationListener): boolean {
    if (!this.available) return false;
    this.stop();
    this.listener = listener;
    try {
      this.watchId = navigator.geolocation.watchPosition(
        this.onPosition,
        this.onError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
      );
      return true;
    } catch {
      this.listener = null;
      this.watchId = null;
      return false;
    }
  }

  stop(): void {
    if (this.watchId !== null && this.available) {
      try {
        navigator.geolocation.clearWatch(this.watchId);
      } catch {
        // The provider is stopped locally even if a browser rejects clearWatch.
      }
    }
    this.watchId = null;
    this.listener = null;
    this.validator.reset();
  }

  private readonly onPosition = (position: GeolocationPosition): void => {
    const coordinates = position.coords;
    const epochMillis = position.timestamp > 0 ? position.timestamp : Date.now();
    const point: GeoPoint = {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      accuracyMetres: Number.isFinite(coordinates.accuracy) ? coordinates.accuracy : Number.NaN,
      bearingDegrees: coordinates.heading !== null && Number.isFinite(coordinates.heading) ? coordinates.heading : Number.NaN,
      speedMetresPerSecond: coordinates.speed !== null && Number.isFinite(coordinates.speed) && coordinates.speed >= 0
        ? coordinates.speed
        : Number.NaN,
      elapsedRealtimeNanos: monotonicNanosForEpoch(epochMillis),
      epochMillis,
      speedAccuracyMetresPerSecond: Number.NaN
    };
    const validation = this.validator.accept(point);
    if (!validation.accepted || validation.point === undefined) {
      this.listener?.onError('An implausible location update was ignored.');
      return;
    }
    const valid = validation.point;
    const ageMillis = Math.max(0, Date.now() - valid.epochMillis);
    const quality = ageMillis > 8_000
      ? LocationQuality.STALE
      : !Number.isFinite(valid.accuracyMetres)
        ? LocationQuality.FAIR
        : valid.accuracyMetres <= 15
          ? LocationQuality.GOOD
          : valid.accuracyMetres <= 40
            ? LocationQuality.FAIR
            : LocationQuality.POOR;
    this.listener?.onLocation(valid, quality);
  };

  private readonly onError = (error: GeolocationPositionError): void => {
    const message = error.code === error.PERMISSION_DENIED
      ? 'Location permission is missing. Drive Mode has stopped.'
      : error.code === error.POSITION_UNAVAILABLE
        ? 'Location is temporarily unavailable.'
        : 'Location is taking longer than expected.';
    this.listener?.onError(message);
  };
}
