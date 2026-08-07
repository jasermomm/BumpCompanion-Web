import {
  DetectionQuality,
  createId,
  type DriveSession,
  type GeoPoint,
  type LocationTrackPoint
} from '../core/models';
import { getDatabase, type BumpDatabase } from './database';

export class DriveRepository {
  constructor(private readonly database: BumpDatabase | Promise<BumpDatabase> = getDatabase()) {}

  async listDrives(): Promise<DriveSession[]> {
    const drives = await (await this.database).getAll('drives');
    return drives.sort((first, second) => second.startedAt - first.startedAt);
  }

  async latestDrive(): Promise<DriveSession | null> {
    return (await this.listDrives())[0] ?? null;
  }

  async getDrive(id: string): Promise<DriveSession | undefined> {
    return (await this.database).get('drives', id);
  }

  async startDrive(
    quality: DetectionQuality = DetectionQuality.BASIC,
    start: GeoPoint | null = null,
    now = Date.now()
  ): Promise<DriveSession> {
    const session: DriveSession = {
      id: createId(),
      startedAt: now,
      endedAt: null,
      durationMillis: 0,
      distanceMetres: 0,
      maximumSpeedMetresPerSecond: 0,
      averageSpeedMetresPerSecond: 0,
      candidateCount: 0,
      confirmedCount: 0,
      rejectedCount: 0,
      knownBumpPasses: 0,
      warningCount: 0,
      startLatitude: start?.latitude ?? null,
      startLongitude: start?.longitude ?? null,
      endLatitude: null,
      endLongitude: null,
      incomplete: true,
      placementProfile: 'automatic',
      vehicleProfile: null,
      algorithmVersion: 2,
      serviceInterruptions: 0,
      detectionQuality: quality
    };
    await (await this.database).put('drives', session);
    return session;
  }

  async updateDrive(session: DriveSession): Promise<void> {
    await (await this.database).put('drives', session);
  }

  async finishDrive(session: DriveSession): Promise<void> {
    await this.updateDrive({ ...session, incomplete: false });
  }

  async recoverIncompleteDrives(now = Date.now()): Promise<DriveSession[]> {
    const database = await this.database;
    const transaction = database.transaction('drives', 'readwrite');
    const drives = await transaction.store.getAll();
    const recovered = drives
      .filter((drive) => drive.incomplete)
      .map((drive) => ({
        ...drive,
        endedAt: drive.endedAt ?? now,
        durationMillis: Math.max(0, now - drive.startedAt),
        incomplete: true,
        serviceInterruptions: drive.serviceInterruptions + 1
      }));
    await Promise.all(recovered.map((drive) => transaction.store.put(drive)));
    await transaction.done;
    return recovered;
  }

  async recordTrackPoints(points: readonly LocationTrackPoint[]): Promise<void> {
    if (points.length === 0) return;
    const database = await this.database;
    const transaction = database.transaction('routePoints', 'readwrite');
    await Promise.all(points.map((point) => transaction.store.put(point)));
    await transaction.done;
  }

  async getTrackPoints(driveId: string): Promise<LocationTrackPoint[]> {
    const points = await (await this.database).getAllFromIndex(
      'routePoints',
      'by-drive',
      driveId
    );
    return points.sort(
      (first, second) => first.elapsedRealtimeNanos - second.elapsedRealtimeNanos
    );
  }

  async deleteHistory(): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction(['routePoints', 'drives'], 'readwrite');
    await Promise.all([
      transaction.objectStore('routePoints').clear(),
      transaction.objectStore('drives').clear()
    ]);
    await transaction.done;
  }
}
