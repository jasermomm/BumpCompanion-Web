import type { GeoPoint } from './models';

const EARTH_RADIUS_METRES = 6_371_000;

export interface BoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function distanceMetres(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number
): number {
  const phi1 = toRadians(latitude1);
  const phi2 = toRadians(latitude2);
  const latitudeDelta = toRadians(latitude2 - latitude1);
  const longitudeDelta = toRadians(longitude2 - longitude1);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(longitudeDelta / 2) ** 2;
  const bounded = Math.min(1, Math.max(0, haversine));
  return EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}

export function initialBearingDegrees(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number
): number {
  const phi1 = toRadians(latitude1);
  const phi2 = toRadians(latitude2);
  const longitudeDelta = toRadians(longitude2 - longitude1);
  const y = Math.sin(longitudeDelta) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(longitudeDelta);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function smallestAngleDifference(first: number, second: number): number {
  const delta = ((((first - second + 540) % 360) + 360) % 360) - 180;
  return Math.abs(delta);
}

function smallestSignedAngle(first: number, second: number): number {
  return ((((first - second + 540) % 360) + 360) % 360) - 180;
}

export function project(
  latitude: number,
  longitude: number,
  projectionDistanceMetres: number,
  bearingDegrees: number
): GeoPoint {
  const angularDistance = projectionDistanceMetres / EARTH_RADIUS_METRES;
  const bearing = toRadians(bearingDegrees);
  const latitude1 = toRadians(latitude);
  const longitude1 = toRadians(longitude);
  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(angularDistance) +
      Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1),
      Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2)
    );

  return {
    latitude: toDegrees(latitude2),
    longitude: toDegrees(longitude2),
    accuracyMetres: Number.NaN,
    bearingDegrees: Number.NaN,
    speedMetresPerSecond: Number.NaN,
    elapsedRealtimeNanos: 0,
    epochMillis: 0,
    speedAccuracyMetresPerSecond: Number.NaN
  };
}

export function boundingBox(
  latitude: number,
  longitude: number,
  radiusMetres: number
): BoundingBox {
  const latitudeDelta = toDegrees(radiusMetres / EARTH_RADIUS_METRES);
  const longitudeDelta = toDegrees(
    radiusMetres /
      (EARTH_RADIUS_METRES * Math.max(0.01, Math.cos(toRadians(latitude))))
  );
  return {
    minLatitude: latitude - latitudeDelta,
    maxLatitude: latitude + latitudeDelta,
    minLongitude: longitude - longitudeDelta,
    maxLongitude: longitude + longitudeDelta
  };
}

export function alongTrackMetres(start: GeoPoint, end: GeoPoint, target: GeoPoint): number {
  const pathDistance = distanceMetres(
    start.latitude,
    start.longitude,
    end.latitude,
    end.longitude
  );
  if (pathDistance < 1) return 0;

  const pathBearing = initialBearingDegrees(
    start.latitude,
    start.longitude,
    end.latitude,
    end.longitude
  );
  const targetBearing = initialBearingDegrees(
    start.latitude,
    start.longitude,
    target.latitude,
    target.longitude
  );
  const targetDistance = distanceMetres(
    start.latitude,
    start.longitude,
    target.latitude,
    target.longitude
  );
  return targetDistance * Math.cos(toRadians(smallestSignedAngle(targetBearing, pathBearing)));
}

export const GeoMath = {
  distanceMetres,
  initialBearingDegrees,
  smallestAngleDifference,
  project,
  boundingBox,
  alongTrackMetres
} as const;
