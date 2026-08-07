import { afterEach, describe, expect, it } from 'vitest';
import {
  DATABASE_VERSION,
  clearAllLocalData,
  deleteBumpDatabase,
  openBumpDatabase
} from '../../src/data/database';
import { makeBump, makeCandidate, makeDrive, makePoint } from './helpers';

const databases: string[] = [];

function databaseName(): string {
  const name = `database-test-${crypto.randomUUID()}`;
  databases.push(name);
  return name;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => deleteBumpDatabase(name)));
});
describe('IndexedDB schema', () => {
  it('migrates v1 data through v2 and v3 without data loss', async () => {
    const name = databaseName();
    const version1 = await openBumpDatabase(name, 1);
    expect([...version1.objectStoreNames]).not.toContain('routePoints');
    expect([...version1.objectStoreNames]).not.toContain('meta');
    const bump = makeBump({ id: 'migration-bump' });
    await version1.put('bumps', bump);
    version1.close();

    const current = await openBumpDatabase(name, DATABASE_VERSION);
    expect(current.version).toBe(3);
    expect([...current.objectStoreNames]).toEqual(
      expect.arrayContaining(['routePoints', 'meta', 'bumps', 'settings'])
    );
    expect(await current.get('bumps', bump.id)).toEqual(bump);
    const transaction = current.transaction('bumps');
    expect([...transaction.store.indexNames]).toEqual(
      expect.arrayContaining(['by-imported-source', 'by-coordinate'])
    );
    current.close();
  });

  it('clears every user-data store in one operation', async () => {
    const database = await openBumpDatabase(databaseName());
    const point = makePoint();
    const drive = makeDrive({ id: 'drive' });
    await database.put('settings', {
      key: 'app',
      value: {
        onboardingComplete: true
      } as never,
      updatedAt: 1
    });
    await database.put('bumps', makeBump({ id: 'bump' }));
    await database.put('candidates', makeCandidate({ id: 'candidate' }));
    await database.put('drives', drive);
    await database.put('encounters', {
      id: 'encounter',
      bumpId: 'bump',
      candidateId: null,
      driveId: drive.id,
      encounteredAt: 1,
      location: point,
      confidence: 1,
      source: makeBump().source
    });
    await database.put('routePoints', { ...point, driveId: drive.id });
    await database.put('meta', { key: 'active-drive', value: true, updatedAt: 1 });

    await clearAllLocalData(database);

    for (const store of database.objectStoreNames) {
      expect(await database.count(store)).toBe(0);
    }
    database.close();
  });
});
