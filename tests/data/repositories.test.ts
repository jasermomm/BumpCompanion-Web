import { afterEach, describe, expect, it } from 'vitest';
import {
  BumpSource,
  BumpStatus,
  CandidateDecision,
  DetectionQuality
} from '../../src/core/models';
import { BumpRepository } from '../../src/data/bumpRepository';
import { deleteBumpDatabase, openBumpDatabase } from '../../src/data/database';
import { DriveRepository } from '../../src/data/driveRepository';
import { makeBump, makeCandidate, makeDrive, makePoint } from './helpers';

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => deleteBumpDatabase(name)));
});

async function fixture() {
  const name = `repository-${crypto.randomUUID()}`;
  names.push(name);
  const database = await openBumpDatabase(name);
  return {
    database,
    bumps: new BumpRepository(database),
    drives: new DriveRepository(database)
  };
}

describe('BumpRepository', () => {
  it('merges nearby evidence with weighted coordinates and retains stronger metadata', async () => {
    const { database, bumps } = await fixture();
    const first = makeBump({
      id: 'first-bump',
      latitude: 30,
      confidence: 0.7,
      coordinateConfidence: 0.5,
      encounterCount: 2,
      confirmationCount: 1,
      source: BumpSource.IMPORTED,
      status: BumpStatus.IMPORTED
    });
    expect((await bumps.saveOrMergeBump(first)).createdNew).toBe(true);
    const second = makeBump({
      id: 'second-bump',
      latitude: 30.00005,
      confidence: 0.95,
      coordinateConfidence: 0.9,
      encounterCount: 1,
      confirmationCount: 1,
      source: BumpSource.DETECTED,
      status: BumpStatus.CONFIRMED
    });

    const result = await bumps.saveOrMergeBump(second);

    expect(result.createdNew).toBe(false);
    expect(result.bump.id).toBe(first.id);
    expect(result.bump.confidence).toBe(0.95);
    expect(result.bump.source).toBe(BumpSource.DETECTED);
    expect(result.bump.status).toBe(BumpStatus.CONFIRMED);
    expect(result.bump.encounterCount).toBe(3);
    expect(await bumps.listBumps()).toHaveLength(1);
    database.close();
  });

  it('filters warning candidates by state, bounding distance, and per-bump preference', async () => {
    const { database, bumps } = await fixture();
    const location = makePoint({ latitude: 30, longitude: 31 });
    await Promise.all([
      bumps.updateBump(makeBump({ id: 'warn', latitude: 30.0005 })),
      bumps.updateBump(makeBump({ id: 'muted', latitude: 30.0004, warningEnabled: false })),
      bumps.updateBump(makeBump({ id: 'archived', latitude: 30.0003, archived: true })),
      bumps.updateBump(makeBump({ id: 'far', latitude: 30.02 }))
    ]);

    expect((await bumps.queryWarningCandidates(location, 150)).map((bump) => bump.id)).toEqual([
      'warn'
    ]);
    database.close();
  });

  it('confirms and rejects candidates transactionally with encounters and drive counts', async () => {
    const { database, bumps } = await fixture();
    const drive = makeDrive({ id: 'review-drive' });
    await database.put('drives', drive);
    const confirm = makeCandidate({ id: 'confirm-me', driveId: drive.id });
    const reject = makeCandidate({
      id: 'reject-me',
      driveId: drive.id,
      latitude: 30.01,
      longitude: 31.01
    });
    await bumps.saveCandidate(confirm);
    await bumps.saveCandidate(reject);

    const confirmed = await bumps.confirmCandidate(confirm.id);
    const confirmedAgain = await bumps.confirmCandidate(confirm.id);
    await bumps.decideCandidate(reject.id, CandidateDecision.POTHOLE, 'single impulse');

    expect(confirmed?.algorithmVersion).toBe(2);
    expect(confirmedAgain?.id).toBe(confirmed?.id);
    expect((await bumps.getCandidate(confirm.id))?.decision).toBe(CandidateDecision.CONFIRMED);
    expect((await bumps.getCandidate(reject.id))?.decision).toBe(CandidateDecision.POTHOLE);
    expect(await bumps.encountersForBump(confirmed!.id)).toHaveLength(1);
    expect(await database.get('drives', drive.id)).toMatchObject({
      confirmedCount: 1,
      rejectedCount: 1
    });
    database.close();
  });

  it('deletes a bump and its encounter/import references atomically', async () => {
    const { database, bumps } = await fixture();
    const bump = makeBump({ id: 'delete-bump' });
    await bumps.updateBump(bump);
    await database.put('encounters', {
      id: 'delete-encounter',
      bumpId: bump.id,
      candidateId: null,
      driveId: null,
      encounteredAt: 1,
      location: makePoint(),
      confidence: 1,
      source: BumpSource.DETECTED
    });
    await database.put('importBatchItems', {
      batchId: 'batch',
      bumpId: bump.id,
      createdNew: true
    });

    await bumps.deleteBump(bump.id);

    expect(await database.get('bumps', bump.id)).toBeUndefined();
    expect(await database.count('encounters')).toBe(0);
    expect(await database.count('importBatchItems')).toBe(0);
    database.close();
  });
});

describe('DriveRepository', () => {
  it('starts, finishes, recovers, records routes, and deletes history', async () => {
    const { database, drives } = await fixture();
    const session = await drives.startDrive(
      DetectionQuality.FULL,
      makePoint({ latitude: 30.2, longitude: 31.2 }),
      1_000
    );
    expect(session.startLatitude).toBe(30.2);
    await drives.recordTrackPoints([
      { ...makePoint({ elapsedRealtimeNanos: 2_000_000_000, epochMillis: 2_000 }), driveId: session.id },
      { ...makePoint({ elapsedRealtimeNanos: 1_000_000_000, epochMillis: 1_000 }), driveId: session.id }
    ]);
    expect((await drives.getTrackPoints(session.id)).map((point) => point.epochMillis)).toEqual([
      1_000,
      2_000
    ]);

    const recovered = await drives.recoverIncompleteDrives(61_000);
    expect(recovered[0]).toMatchObject({
      id: session.id,
      durationMillis: 60_000,
      serviceInterruptions: 1,
      incomplete: true
    });
    await drives.finishDrive(recovered[0]);
    expect((await drives.latestDrive())?.incomplete).toBe(false);
    await drives.deleteHistory();
    expect(await drives.listDrives()).toEqual([]);
    expect(await database.count('routePoints')).toBe(0);
    database.close();
  });
});
