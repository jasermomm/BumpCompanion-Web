import type { GeoPoint } from './models';
import { GeoMath } from './geo';

export interface LocationValidationResult {
  accepted: boolean;
  point?: GeoPoint;
  reason?: string;
}
/**
 * Rejects malformed or physically implausible fixes before they reach drive state.
 * The validator deliberately keeps no state across a page suspension; callers must
 * call reset() when visibility or timing continuity is lost.
 */
export class LocationValidator {
  private previous: GeoPoint | null = null;

  reset(): void {
    this.previous = null;
  }

  accept(position: GeoPoint): LocationValidationResult {
    if (
      !Number.isFinite(position.latitude) ||
      !Number.isFinite(position.longitude) ||
      position.latitude < -90 ||
      position.latitude > 90 ||
      position.longitude < -180 ||
      position.longitude > 180
    ) {
      return { accepted: false, reason: 'invalid-coordinates' };
    }
    if (Number.isFinite(position.accuracyMetres) && position.accuracyMetres < 0) {
      return { accepted: false, reason: 'invalid-accuracy' };
    }
    if (
      Number.isFinite(position.speedMetresPerSecond) &&
      (position.speedMetresPerSecond < 0 || position.speedMetresPerSecond > 65)
    ) {
      return { accepted: false, reason: 'impossible-speed' };
    }

    const previous = this.previous;
    if (previous === null) {
      const first = {
        ...position,
        bearingDegrees: normalizeBearing(position.bearingDegrees),
        speedMetresPerSecond: Number.isFinite(position.speedMetresPerSecond)
          ? position.speedMetresPerSecond
          : Number.NaN
      };
      this.previous = first;
      return { accepted: true, point: first };
    }

    const elapsedSeconds = elapsedBetween(previous, position);
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return { accepted: false, reason: 'non-monotonic-timestamp' };
    }

    const distance = GeoMath.distanceMetres(
      previous.latitude,
      previous.longitude,
      position.latitude,
      position.longitude
    );
    const accuracyAllowance =
      accuracyContribution(previous.accuracyMetres) + accuracyContribution(position.accuracyMetres);
    const plausibleDistance = Math.max(80, elapsedSeconds * 65) + accuracyAllowance;
    if (distance > plausibleDistance) {
      return { accepted: false, reason: 'implausible-jump' };
    }

    const derivedSpeed = distance / elapsedSeconds;
    const rawSpeed = Number.isFinite(position.speedMetresPerSecond)
      ? position.speedMetresPerSecond
      : derivedSpeed;
    if (!Number.isFinite(rawSpeed) || rawSpeed > 65) {
      return { accepted: false, reason: 'impossible-speed' };
    }

    const previousSpeed = previous.speedMetresPerSecond;
    const smoothedSpeed = Number.isFinite(previousSpeed)
      ? previousSpeed * 0.65 + rawSpeed * 0.35
      : rawSpeed;
    const derivedBearing =
      distance >= 1
        ? GeoMath.initialBearingDegrees(
            previous.latitude,
            previous.longitude,
            position.latitude,
            position.longitude
          )
        : previous.bearingDegrees;
    const bearing = Number.isFinite(position.bearingDegrees)
      ? normalizeBearing(position.bearingDegrees)
      : derivedBearing;

    const accepted: GeoPoint = {
      ...position,
      bearingDegrees: bearing,
      speedMetresPerSecond: smoothedSpeed
    };
    this.previous = accepted;
    return { accepted: true, point: accepted };
  }
}

function elapsedBetween(previous: GeoPoint, current: GeoPoint): number {
  if (previous.elapsedRealtimeNanos > 0 && current.elapsedRealtimeNanos > 0) {
    return (current.elapsedRealtimeNanos - previous.elapsedRealtimeNanos) / 1_000_000_000;
  }
  return (current.epochMillis - previous.epochMillis) / 1_000;
}

function accuracyContribution(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function normalizeBearing(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return ((value % 360) + 360) % 360;
}
