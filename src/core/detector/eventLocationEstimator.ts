import type { GeoPoint } from '../models';
import type { EventLocationEstimate } from './types';

const EARTH_RADIUS_METRES = 6_371_000;

function project(latitude: number, longitude: number, distanceMetres: number, bearingDegrees: number): {
  latitude: number;
  longitude: number;
} {
  const angular = distanceMetres / EARTH_RADIUS_METRES;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const latitude1 = (latitude * Math.PI) / 180;
  const longitude1 = (longitude * Math.PI) / 180;
  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(angular) +
      Math.cos(latitude1) * Math.sin(angular) * Math.cos(bearing)
  );
  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude1),
      Math.cos(angular) - Math.sin(latitude1) * Math.sin(latitude2)
    );
  return { latitude: (latitude2 * 180) / Math.PI, longitude: (longitude2 * 180) / Math.PI };
}

export class EventLocationEstimator {
  estimate(eventElapsedRealtimeNanos: number, locations: readonly GeoPoint[]): EventLocationEstimate {
    if (locations.length === 0) return this.unavailable();
    const sorted = [...locations].sort((a, b) => a.elapsedRealtimeNanos - b.elapsedRealtimeNanos);
    const before = [...sorted].reverse().find((point) => point.elapsedRealtimeNanos <= eventElapsedRealtimeNanos);
    const after = sorted.find((point) => point.elapsedRealtimeNanos >= eventElapsedRealtimeNanos);
    const nearest = sorted.reduce((best, point) =>
      Math.abs(point.elapsedRealtimeNanos - eventElapsedRealtimeNanos) <
      Math.abs(best.elapsedRealtimeNanos - eventElapsedRealtimeNanos)
        ? point
        : best
    );
    const ageMillis = Math.trunc(
      Math.abs(nearest.elapsedRealtimeNanos - eventElapsedRealtimeNanos) / 1_000_000
    );
    if (ageMillis > 8_000) {
      return { point: null, coordinateConfidence: 0, method: 'stale', correctionDistanceMetres: 0 };
    }

    if (before && after && before !== after && after.elapsedRealtimeNanos > before.elapsedRealtimeNanos) {
      const fraction = Math.min(
        1,
        Math.max(
          0,
          (eventElapsedRealtimeNanos - before.elapsedRealtimeNanos) /
            (after.elapsedRealtimeNanos - before.elapsedRealtimeNanos)
        )
      );
      const accuracyValues = [before.accuracyMetres, after.accuracyMetres].filter(Number.isFinite);
      const accuracyMetres =
        accuracyValues.length > 0 ? Math.max(...accuracyValues) : Number.NaN;
      const speedMetresPerSecond = Number.isFinite(before.speedMetresPerSecond)
        ? before.speedMetresPerSecond
        : after.speedMetresPerSecond;
      const bearingDegrees = Number.isFinite(before.bearingDegrees)
        ? before.bearingDegrees
        : after.bearingDegrees;
      const point: GeoPoint = {
        latitude: before.latitude + (after.latitude - before.latitude) * fraction,
        longitude: before.longitude + (after.longitude - before.longitude) * fraction,
        accuracyMetres,
        speedMetresPerSecond,
        bearingDegrees,
        elapsedRealtimeNanos: eventElapsedRealtimeNanos,
        epochMillis: nearest.epochMillis,
        speedAccuracyMetresPerSecond: Number.NaN
      };
      return {
        point,
        coordinateConfidence: this.confidenceFor(accuracyMetres, ageMillis),
        method: 'interpolated',
        correctionDistanceMetres: 0
      };
    }

    let point = { ...nearest };
    let correctionDistanceMetres = 0;
    const deltaSeconds =
      (eventElapsedRealtimeNanos - nearest.elapsedRealtimeNanos) / 1_000_000_000;
    if (
      Math.abs(deltaSeconds) <= 3 &&
      Number.isFinite(nearest.speedMetresPerSecond) &&
      Number.isFinite(nearest.bearingDegrees)
    ) {
      const distance = nearest.speedMetresPerSecond * deltaSeconds;
      const projected = project(nearest.latitude, nearest.longitude, distance, nearest.bearingDegrees);
      point = { ...nearest, ...projected, elapsedRealtimeNanos: eventElapsedRealtimeNanos };
      correctionDistanceMetres = Math.abs(distance);
    }
    return {
      point,
      coordinateConfidence: this.confidenceFor(nearest.accuracyMetres, ageMillis),
      method: correctionDistanceMetres > 0 ? 'projected' : 'nearest',
      correctionDistanceMetres
    };
  }

  private unavailable(): EventLocationEstimate {
    return { point: null, coordinateConfidence: 0, method: 'unavailable', correctionDistanceMetres: 0 };
  }

  private confidenceFor(accuracy: number, ageMillis: number): number {
    const accuracyScore = !Number.isFinite(accuracy)
      ? 0.45
      : accuracy <= 8
        ? 1
        : accuracy <= 20
          ? 0.82
          : accuracy <= 40
            ? 0.58
            : accuracy <= 80
              ? 0.32
              : 0.15;
    const ageScore = Math.min(1, Math.max(0, 1 - ageMillis / 8_000));
    return Math.min(1, Math.max(0, accuracyScore * 0.75 + ageScore * 0.25));
  }
}
