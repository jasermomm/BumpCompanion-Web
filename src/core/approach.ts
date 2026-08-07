import { Directionality, type GeoPoint, type SpeedBump } from './models';
import { GeoMath } from './geo';

export enum WarningPhase {
  EARLY = 'EARLY',
  MAIN = 'MAIN',
  IMMEDIATE = 'IMMEDIATE'
}

export type ApproachDecision =
  | { type: 'none' }
  | { type: 'tracking'; bump: SpeedBump; distanceMetres: number; score: number }
  | {
      type: 'warn';
      bump: SpeedBump;
      distanceMetres: number;
      phase: WarningPhase;
      score: number;
    }
  | { type: 'passed'; bump: SpeedBump };

interface Track {
  distances: number[];
  warnedAt: number | null;
  closestDistance: number;
  wasInsidePassRadius: boolean;
  passed: boolean;
}

const NONE: ApproachDecision = { type: 'none' };

export class ApproachPredictor {
  private readonly tracks = new Map<string, Track>();
  private readonly recentPath: GeoPoint[] = [];

  constructor(private readonly warningCooldownMillis = 45_000) {}

  reset(): void {
    this.tracks.clear();
    this.recentPath.length = 0;
  }

  update(
    location: GeoPoint,
    candidates: readonly SpeedBump[],
    nowMillis: number,
    warningsEnabled = true,
    adaptiveDistance = true,
    fixedWarningDistanceMetres = 100,
    cooldownMillis = this.warningCooldownMillis
  ): ApproachDecision {
    this.updatePath(location);
    const speed = Number.isFinite(location.speedMetresPerSecond)
      ? location.speedMetresPerSecond
      : 0;
    if (speed < 1.2) return NONE;

    const travelBearing = this.stableTravelBearing(location);
    if (travelBearing === null) return NONE;

    let best: Extract<ApproachDecision, { type: 'tracking' }> | null = null;
    for (const bump of candidates) {
      if (!bump.warningEnabled || bump.archived || bump.markedRemoved) continue;

      const distance = GeoMath.distanceMetres(
        location.latitude,
        location.longitude,
        bump.latitude,
        bump.longitude
      );
      const track = this.trackFor(bump.id);
      track.distances.push(distance);
      if (track.distances.length > 5) track.distances.shift();
      track.closestDistance = Math.min(track.closestDistance, distance);

      if (distance <= this.passRadius(location.accuracyMetres)) {
        track.wasInsidePassRadius = true;
      }
      const recentPairs = track.distances.slice(-3);
      const increasing =
        recentPairs.length >= 3 &&
        recentPairs.slice(1).every((value, index) => value > recentPairs[index] + 1.5);
      if (
        track.wasInsidePassRadius &&
        increasing &&
        distance > track.closestDistance + 8
      ) {
        if (!track.passed) {
          track.passed = true;
          return { type: 'passed', bump };
        }
        continue;
      }
      if (track.passed) continue;

      const toBumpBearing = GeoMath.initialBearingDegrees(
        location.latitude,
        location.longitude,
        bump.latitude,
        bump.longitude
      );
      const relativeBearing = GeoMath.smallestAngleDifference(travelBearing, toBumpBearing);
      const headingTolerance = this.headingConeDegrees(speed, location.accuracyMetres);
      const ahead = relativeBearing <= headingTolerance;
      const decreasing =
        recentPairs.length >= 3 &&
        recentPairs.slice(1).every((value, index) => value < recentPairs[index] - 0.5);
      const directionCompatible = this.directionCompatible(bump, travelBearing);
      const corridorScore = this.pathCorridorScore(bump, location, travelBearing);
      if (!ahead || !decreasing || !directionCompatible || corridorScore <= 0.35) continue;

      const bearingScore = clamp(1 - relativeBearing / headingTolerance, 0, 1);
      const gpsScore = !Number.isFinite(location.accuracyMetres)
        ? 0.45
        : location.accuracyMetres <= 12
          ? 1
          : location.accuracyMetres <= 30
            ? 0.72
            : location.accuracyMetres <= 60
              ? 0.42
              : 0.18;
      const decreaseScore = this.decreasingStrength(track.distances);
      const confidenceScore = clamp(bump.confidence, 0.25, 1);
      const score =
        bearingScore * 0.3 +
        gpsScore * 0.18 +
        decreaseScore * 0.25 +
        confidenceScore * 0.17 +
        corridorScore * 0.1;
      if (score < 0.58) continue;

      const tracking = { type: 'tracking' as const, bump, distanceMetres: distance, score };
      if (best === null || tracking.score > best.score) best = tracking;
    }

    if (best === null) return NONE;
    const warningDistance =
      best.bump.customWarningDistanceMetres ??
      (adaptiveDistance
        ? this.adaptiveWarningDistance(speed, location.accuracyMetres)
        : clamp(fixedWarningDistanceMetres, 20, 1_000));
    if (!warningsEnabled || best.distanceMetres > warningDistance) return best;

    const track = this.tracks.get(best.bump.id)!;
    const persistedWarning = best.bump.lastWarnedAt;
    const lastWarning =
      track.warnedAt === null
        ? persistedWarning
        : persistedWarning === null
          ? track.warnedAt
          : Math.max(track.warnedAt, persistedWarning);
    if (lastWarning !== null && nowMillis - lastWarning < Math.max(0, cooldownMillis)) {
      return best;
    }

    const phase =
      best.distanceMetres <= 35
        ? WarningPhase.IMMEDIATE
        : best.distanceMetres <= warningDistance * 0.65
          ? WarningPhase.MAIN
          : WarningPhase.EARLY;
    track.warnedAt = nowMillis;
    return { ...best, type: 'warn', phase };
  }

  adaptiveWarningDistance(speedMetresPerSecond: number, gpsAccuracyMetres: number): number {
    const kilometresPerHour = speedMetresPerSecond * 3.6;
    const base =
      kilometresPerHour < 15
        ? 45
        : kilometresPerHour < 30
          ? 75
          : kilometresPerHour < 50
            ? 125
            : kilometresPerHour < 80
              ? 205
              : 260;
    const gpsAdjustment = !Number.isFinite(gpsAccuracyMetres)
      ? 15
      : gpsAccuracyMetres <= 15
        ? 0
        : gpsAccuracyMetres <= 35
          ? 15
          : 30;
    return Math.min(300, base + gpsAdjustment);
  }

  private trackFor(id: string): Track {
    const existing = this.tracks.get(id);
    if (existing) return existing;
    const created: Track = {
      distances: [],
      warnedAt: null,
      closestDistance: Number.MAX_VALUE,
      wasInsidePassRadius: false,
      passed: false
    };
    this.tracks.set(id, created);
    return created;
  }

  private updatePath(location: GeoPoint): void {
    const last = this.recentPath.at(-1);
    if (
      last &&
      GeoMath.distanceMetres(
        last.latitude,
        last.longitude,
        location.latitude,
        location.longitude
      ) < 1.5
    ) {
      return;
    }
    this.recentPath.push(location);
    if (this.recentPath.length > 8) this.recentPath.shift();
  }

  private stableTravelBearing(location: GeoPoint): number | null {
    if (this.recentPath.length >= 3) {
      const first = this.recentPath[0];
      const last = this.recentPath.at(-1)!;
      if (
        GeoMath.distanceMetres(
          first.latitude,
          first.longitude,
          last.latitude,
          last.longitude
        ) >= 8
      ) {
        return GeoMath.initialBearingDegrees(
          first.latitude,
          first.longitude,
          last.latitude,
          last.longitude
        );
      }
    }
    return Number.isFinite(location.bearingDegrees) ? location.bearingDegrees : null;
  }

  private headingConeDegrees(speed: number, accuracy: number): number {
    const kilometresPerHour = speed * 3.6;
    const base = kilometresPerHour < 15 ? 58 : kilometresPerHour < 40 ? 42 : 32;
    return base + (Number.isFinite(accuracy) && accuracy > 35 ? 8 : 0);
  }

  private directionCompatible(bump: SpeedBump, travelBearing: number): boolean {
    switch (bump.directionality) {
      case Directionality.UNKNOWN:
      case Directionality.BIDIRECTIONAL:
        return true;
      case Directionality.ONE_DIRECTION:
        return (
          bump.primaryBearing === null ||
          GeoMath.smallestAngleDifference(bump.primaryBearing, travelBearing) <=
            bump.bearingTolerance
        );
      case Directionality.TWO_CLUSTERS:
        return [bump.primaryBearing, bump.oppositeBearing]
          .filter((bearing): bearing is number => bearing !== null)
          .some(
            (bearing) =>
              GeoMath.smallestAngleDifference(bearing, travelBearing) <= bump.bearingTolerance
          );
    }
  }

  private decreasingStrength(distances: readonly number[]): number {
    if (distances.length < 3) return 0;
    return clamp((distances[0] - distances.at(-1)!) / 18, 0, 1);
  }

  private pathCorridorScore(
    bump: SpeedBump,
    location: GeoPoint,
    bearing: number
  ): number {
    const projectionDistance = 220;
    const projected = GeoMath.project(
      location.latitude,
      location.longitude,
      projectionDistance,
      bearing
    );
    const bumpPoint: GeoPoint = {
      ...projected,
      latitude: bump.latitude,
      longitude: bump.longitude
    };
    const along = GeoMath.alongTrackMetres(location, projected, bumpPoint);
    if (along < -5 || along > projectionDistance * 1.25) return 0;

    const direct = GeoMath.distanceMetres(
      location.latitude,
      location.longitude,
      bump.latitude,
      bump.longitude
    );
    const projectedDistance = GeoMath.distanceMetres(
      projected.latitude,
      projected.longitude,
      bump.latitude,
      bump.longitude
    );
    const corridorWidth =
      25 + (Number.isFinite(location.accuracyMetres) ? location.accuracyMetres : 30);
    const perpendicularApproximation = Math.sqrt(Math.max(0, direct ** 2 - along ** 2));
    const corridorScore = clamp(1 - perpendicularApproximation / corridorWidth, 0, 1);
    const endpointScore = clamp(1 - projectedDistance / 320, 0, 1);
    return Math.max(corridorScore, endpointScore * 0.5);
  }

  private passRadius(accuracy: number): number {
    if (!Number.isFinite(accuracy)) return 22;
    if (accuracy <= 10) return 14;
    if (accuracy <= 30) return 20;
    return 28;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
