import {
  BumpSource,
  BumpStatus,
  CandidateDecision,
  Directionality,
  RoadEventType,
  createId,
  createSpeedBump,
  type CandidateEvent,
  type DriveSession,
  type EncounterSummary,
  type GeoPoint,
  type SpeedBump
} from '../core/models';
import { GeoMath } from '../core/geo';
import { getDatabase, type BumpDatabase } from './database';

export interface MergeResult {
  bump: SpeedBump;
  createdNew: boolean;
  mergedIntoId: string | null;
}

export class BumpRepository {
  constructor(private readonly database: BumpDatabase | Promise<BumpDatabase> = getDatabase()) {}

  async listBumps(status: BumpStatus | null = null): Promise<SpeedBump[]> {
    const database = await this.database;
    const bumps = status
      ? await database.getAllFromIndex('bumps', 'by-status', status)
      : await database.getAll('bumps');
    return bumps.sort((first, second) => second.lastDetectedAt - first.lastDetectedAt);
  }

  async confirmedCount(): Promise<number> {
    const confirmed = await this.listBumps(BumpStatus.CONFIRMED);
    return confirmed.filter((bump) => !bump.archived && !bump.markedRemoved).length;
  }

  async listPendingCandidates(): Promise<CandidateEvent[]> {
    const database = await this.database;
    const candidates = await database.getAllFromIndex(
      'candidates',
      'by-decision',
      CandidateDecision.PENDING
    );
    return candidates.sort((first, second) => second.detectedAt - first.detectedAt);
  }

  async pendingCount(): Promise<number> {
    return (await this.listPendingCandidates()).length;
  }

  async encountersForBump(bumpId: string): Promise<EncounterSummary[]> {
    const database = await this.database;
    const encounters = await database.getAllFromIndex('encounters', 'by-bump', bumpId);
    return encounters.sort((first, second) => second.encounteredAt - first.encounteredAt);
  }

  async getBump(id: string): Promise<SpeedBump | undefined> {
    return (await this.database).get('bumps', id);
  }

  async getCandidate(id: string): Promise<CandidateEvent | undefined> {
    return (await this.database).get('candidates', id);
  }

  async saveCandidate(candidate: CandidateEvent): Promise<void> {
    await (await this.database).put('candidates', candidate);
  }

  async confirmCandidate(candidateId: string): Promise<SpeedBump | null> {
    const database = await this.database;
    const transaction = database.transaction(
      ['candidates', 'bumps', 'encounters', 'drives'],
      'readwrite'
    );
    const candidate = await transaction.objectStore('candidates').get(candidateId);
    if (candidate?.latitude === null || candidate?.longitude === null || !candidate) {
      await transaction.done;
      return null;
    }
    if (candidate.decision === CandidateDecision.CONFIRMED) {
      const priorEncounter = (
        await transaction.objectStore('encounters').index('by-candidate').getAll(candidate.id)
      )[0];
      const priorBump = priorEncounter?.bumpId
        ? await transaction.objectStore('bumps').get(priorEncounter.bumpId)
        : undefined;
      await transaction.done;
      return priorBump ?? null;
    }

    const proposed = createSpeedBump({
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      rawLatitude: candidate.latitude,
      rawLongitude: candidate.longitude,
      horizontalAccuracyMetres: candidate.horizontalAccuracyMetres ?? Number.NaN,
      coordinateConfidence: candidate.coordinateConfidence,
      confidence: candidate.confidence,
      status: BumpStatus.CONFIRMED,
      source: candidate.source,
      primaryBearing: candidate.bearingDegrees,
      firstDetectedAt: candidate.detectedAt,
      lastDetectedAt: candidate.detectedAt,
      algorithmVersion: 2
    });
    const bumpsStore = transaction.objectStore('bumps');
    const existing = await bumpsStore.getAll();
    const merged = mergeSpeedBump(proposed, existing);
    await bumpsStore.put(merged.bump);

    await transaction.objectStore('candidates').put({
      ...candidate,
      decision: CandidateDecision.CONFIRMED
    });
    await transaction.objectStore('encounters').put({
      id: createId(),
      bumpId: merged.bump.id,
      candidateId: candidate.id,
      driveId: candidate.driveId,
      encounteredAt: candidate.detectedAt,
      location: pointFromCandidate(candidate),
      confidence: candidate.confidence,
      source: candidate.source
    });
    await this.incrementDriveDecision(transaction.objectStore('drives'), candidate.driveId, true);
    await transaction.done;
    return merged.bump;
  }

  async decideCandidate(
    candidateId: string,
    decision: CandidateDecision,
    note = ''
  ): Promise<SpeedBump | null> {
    if (decision === CandidateDecision.CONFIRMED) return this.confirmCandidate(candidateId);

    const database = await this.database;
    const transaction = database.transaction(['candidates', 'drives'], 'readwrite');
    const candidates = transaction.objectStore('candidates');
    const candidate = await candidates.get(candidateId);
    if (candidate) {
      const wasPending = candidate.decision === CandidateDecision.PENDING;
      await candidates.put({ ...candidate, decision, note: note.slice(0, 2_000) });
      if (wasPending) {
        await this.incrementDriveDecision(transaction.objectStore('drives'), candidate.driveId, false);
      }
    }
    await transaction.done;
    return null;
  }

  async createManualCandidate(
    driveId: string | null,
    location: GeoPoint | null,
    source = BumpSource.MANUAL
  ): Promise<CandidateEvent> {
    const now = Date.now();
    const hasAccurateLocation =
      location !== null &&
      Number.isFinite(location.accuracyMetres) &&
      location.accuracyMetres <= 25;
    const candidate: CandidateEvent = {
      id: createId(),
      driveId,
      detectedAt: now,
      eventElapsedRealtimeNanos: location?.elapsedRealtimeNanos ?? 0,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      horizontalAccuracyMetres:
        location && Number.isFinite(location.accuracyMetres) ? location.accuracyMetres : null,
      coordinateConfidence: hasAccurateLocation ? 0.9 : 0.55,
      speedMetresPerSecond:
        location && Number.isFinite(location.speedMetresPerSecond)
          ? location.speedMetresPerSecond
          : 0,
      bearingDegrees:
        location && Number.isFinite(location.bearingDegrees) ? location.bearingDegrees : null,
      confidence: 1,
      eventType: RoadEventType.LIKELY_SPEED_BUMP,
      decision: CandidateDecision.PENDING,
      confidenceReasons: ['MANUALLY_MARKED'],
      positiveVerticalPeak: 0,
      negativeVerticalPeak: 0,
      peakToPeak: 0,
      peakGapMillis: 0,
      verticalRms: 0,
      jerkPeak: 0,
      gyroscopeEnergy: 0,
      orientationVariance: 0,
      phoneStability: 1,
      source,
      note: ''
    };
    await this.saveCandidate(candidate);
    return candidate;
  }

  async saveOrMergeBump(bump: SpeedBump): Promise<MergeResult> {
    const database = await this.database;
    const transaction = database.transaction('bumps', 'readwrite');
    const existing = await transaction.store.getAll();
    const result = mergeSpeedBump(bump, existing);
    await transaction.store.put(result.bump);
    await transaction.done;
    return result;
  }

  async queryWarningCandidates(location: GeoPoint, radiusMetres: number): Promise<SpeedBump[]> {
    const database = await this.database;
    const bounds = GeoMath.boundingBox(location.latitude, location.longitude, radiusMetres);
    const latitudeRange = IDBKeyRange.bound(bounds.minLatitude, bounds.maxLatitude);
    const latitudeMatches = await database.getAllFromIndex(
      'bumps',
      'by-latitude',
      latitudeRange
    );
    return latitudeMatches.filter(
      (bump) =>
        bump.longitude >= bounds.minLongitude &&
        bump.longitude <= bounds.maxLongitude &&
        bump.warningEnabled &&
        !bump.archived &&
        !bump.markedRemoved &&
        (bump.status === BumpStatus.CONFIRMED || bump.status === BumpStatus.IMPORTED) &&
        GeoMath.distanceMetres(
          location.latitude,
          location.longitude,
          bump.latitude,
          bump.longitude
        ) <= radiusMetres
    );
  }

  async updateBump(bump: SpeedBump): Promise<void> {
    validateCoordinates(bump.latitude, bump.longitude);
    await (await this.database).put('bumps', bump);
  }

  async setWarningEnabled(id: string, enabled: boolean): Promise<void> {
    await this.patchBump(id, { warningEnabled: enabled });
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.patchBump(id, {
      archived,
      status: archived ? BumpStatus.ARCHIVED : BumpStatus.CONFIRMED
    });
  }

  async markRemoved(id: string): Promise<void> {
    await this.patchBump(id, {
      markedRemoved: true,
      status: BumpStatus.REMOVED,
      warningEnabled: false
    });
  }

  async deleteBump(id: string): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction(
      ['bumps', 'encounters', 'importBatchItems'],
      'readwrite'
    );
    await transaction.objectStore('bumps').delete(id);
    const encounters = transaction.objectStore('encounters');
    for (const key of await encounters.index('by-bump').getAllKeys(id)) {
      await encounters.delete(key);
    }
    const batchItems = transaction.objectStore('importBatchItems');
    for (const key of await batchItems.index('by-bump').getAllKeys(id)) {
      await batchItems.delete(key);
    }
    await transaction.done;
  }

  async recordEncounter(encounter: EncounterSummary): Promise<void> {
    await (await this.database).put('encounters', encounter);
  }

  async updateLastWarned(id: string, timestamp: number): Promise<void> {
    await this.patchBump(id, { lastWarnedAt: timestamp });
  }

  async exportableBumps(): Promise<SpeedBump[]> {
    const bumps = await this.listBumps();
    return bumps.filter(
      (bump) =>
        (bump.status === BumpStatus.CONFIRMED || bump.status === BumpStatus.IMPORTED) &&
        !bump.archived &&
        !bump.markedRemoved
    );
  }

  async deleteAll(): Promise<void> {
    const database = await this.database;
    const stores = [
      'encounters',
      'candidates',
      'bumps',
      'calibrations',
      'importBatchItems',
      'importBatches'
    ] as const;
    const transaction = database.transaction([...stores], 'readwrite');
    await Promise.all(stores.map((store) => transaction.objectStore(store).clear()));
    await transaction.done;
  }

  private async patchBump(id: string, patch: Partial<SpeedBump>): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction('bumps', 'readwrite');
    const bump = await transaction.store.get(id);
    if (bump) await transaction.store.put({ ...bump, ...patch });
    await transaction.done;
  }

  private async incrementDriveDecision(
    store: {
      get(key: string): Promise<DriveSession | undefined>;
      put(value: DriveSession): Promise<unknown>;
    },
    driveId: string | null,
    confirmed: boolean
  ): Promise<void> {
    if (driveId === null) return;
    const drive = await store.get(driveId);
    if (!drive) return;
    await store.put({
      ...drive,
      confirmedCount: drive.confirmedCount + (confirmed ? 1 : 0),
      rejectedCount: drive.rejectedCount + (confirmed ? 0 : 1)
    });
  }
}

/** Pure duplicate matching shared by normal persistence and atomic imports. */
export function mergeSpeedBump(bump: SpeedBump, existingBumps: readonly SpeedBump[]): MergeResult {
  validateCoordinates(bump.latitude, bump.longitude);
  const radius = Number.isFinite(bump.horizontalAccuracyMetres)
    ? Math.min(1_000, Math.max(12, bump.horizontalAccuracyMetres * 1.5))
    : 25;
  const nearby = existingBumps.filter(
    (existing) =>
      GeoMath.distanceMetres(
        existing.latitude,
        existing.longitude,
        bump.latitude,
        bump.longitude
      ) <= radius
  );
  const compatible = nearby.reduce<SpeedBump | null>((best, existing) => {
    if (best === null) return existing;
    return mergeDistance(existing, bump) < mergeDistance(best, bump) ? existing : best;
  }, null);

  if (compatible === null) {
    return { bump, createdNew: true, mergedIntoId: null };
  }

  const oldWeight = Math.max(
    1,
    compatible.coordinateConfidence * compatible.encounterCount
  );
  const newWeight = Math.max(0.25, bump.coordinateConfidence);
  const totalWeight = oldWeight + newWeight;
  const finiteAccuracies = [
    compatible.horizontalAccuracyMetres,
    bump.horizontalAccuracyMetres
  ].filter(Number.isFinite);
  const merged: SpeedBump = {
    ...compatible,
    latitude:
      (compatible.latitude * oldWeight + bump.latitude * newWeight) / totalWeight,
    longitude:
      (compatible.longitude * oldWeight + bump.longitude * newWeight) / totalWeight,
    horizontalAccuracyMetres:
      finiteAccuracies.length > 0 ? Math.min(...finiteAccuracies) : Number.NaN,
    coordinateConfidence: Math.max(
      compatible.coordinateConfidence,
      bump.coordinateConfidence
    ),
    confidence: Math.max(compatible.confidence, bump.confidence),
    lastDetectedAt: Math.max(compatible.lastDetectedAt, bump.lastDetectedAt),
    encounterCount: compatible.encounterCount + Math.max(1, bump.encounterCount),
    confirmationCount: compatible.confirmationCount + bump.confirmationCount,
    source:
      compatible.source === BumpSource.IMPORTED && bump.source !== BumpSource.IMPORTED
        ? bump.source
        : compatible.source,
    status:
      compatible.status === BumpStatus.IMPORTED && bump.status === BumpStatus.CONFIRMED
        ? BumpStatus.CONFIRMED
        : compatible.status,
    warningEnabled: compatible.warningEnabled || bump.warningEnabled
  };
  return { bump: merged, createdNew: false, mergedIntoId: merged.id };
}

function mergeDistance(existing: SpeedBump, incoming: SpeedBump): number {
  const bearingPenalty =
    existing.primaryBearing !== null && incoming.primaryBearing !== null
      ? GeoMath.smallestAngleDifference(existing.primaryBearing, incoming.primaryBearing) / 10
      : 0;
  return (
    GeoMath.distanceMetres(
      existing.latitude,
      existing.longitude,
      incoming.latitude,
      incoming.longitude
    ) + bearingPenalty
  );
}

function pointFromCandidate(candidate: CandidateEvent): GeoPoint {
  return {
    latitude: candidate.latitude!,
    longitude: candidate.longitude!,
    accuracyMetres: candidate.horizontalAccuracyMetres ?? Number.NaN,
    bearingDegrees: candidate.bearingDegrees ?? Number.NaN,
    speedMetresPerSecond: candidate.speedMetresPerSecond,
    elapsedRealtimeNanos: candidate.eventElapsedRealtimeNanos,
    epochMillis: candidate.detectedAt,
    speedAccuracyMetresPerSecond: Number.NaN
  };
}

function validateCoordinates(latitude: number, longitude: number): void {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new RangeError('Invalid bump coordinates');
  }
}

// Keep the enum in this module's generated declaration surface for import consumers.
export { Directionality };
