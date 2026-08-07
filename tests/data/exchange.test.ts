import { afterEach, describe, expect, it } from 'vitest';
import { BumpStatus } from '../../src/core/models';
import { BumpRepository } from '../../src/data/bumpRepository';
import { deleteBumpDatabase, openBumpDatabase } from '../../src/data/database';
import {
  BumpExchangeManager,
  ExchangeValidationError,
  MAX_IMPORT_BYTES,
  serializeBumpExport,
  type BumpExportFile
} from '../../src/data/exchange';
import { sha256Hex } from '../../src/data/sha256';
import { makeBump } from './helpers';

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => deleteBumpDatabase(name)));
});

async function createManager(label: string) {
  const name = `${label}-${crypto.randomUUID()}`;
  names.push(name);
  const database = await openBumpDatabase(name);
  return { database, manager: new BumpExchangeManager(database), bumps: new BumpRepository(database) };
}
describe('.bumpcompanion exchange', () => {
  it('exports only active trusted bumps with a valid deterministic SHA-256', async () => {
    const { database, manager, bumps } = await createManager('export');
    await bumps.updateBump(makeBump({ id: 'exported-bump', horizontalAccuracyMetres: Number.NaN }));
    await bumps.updateBump(
      makeBump({ id: 'archived-bump', status: BumpStatus.ARCHIVED, archived: true })
    );

    const artifact = await manager.createExport('BumpCompanion export');

    expect(artifact.count).toBe(1);
    expect(artifact.file.bumps[0]).toMatchObject({
      id: 'exported-bump',
      horizontalAccuracyMetres: 999
    });
    expect(artifact.text).toContain('"latitude": 30.001');
    expect(artifact.text).toContain('"horizontalAccuracyMetres": 999.0');
    expect(artifact.text).not.toContain('"primaryBearing"');
    expect(await manager.readAndValidate(artifact.text)).toEqual(artifact.file);
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    database.close();
  });

  it('previews and atomically imports valid items while reporting invalid items', async () => {
    const source = await createManager('source');
    await source.bumps.updateBump(makeBump({ id: 'new-valid-bump', latitude: 30.02 }));
    const artifact = await source.manager.createExport(null, 'Family list');
    const invalid = makeBump({ id: 'invalid-bump', latitude: 91 });
    const unsigned: BumpExportFile = {
      ...artifact.file,
      bumps: [...artifact.file.bumps, invalid],
      checksum: null
    };
    const checksum = await sha256Hex(serializeBumpExport(unsigned, false));
    const text = serializeBumpExport({ ...unsigned, checksum });

    const target = await createManager('target');
    const preview = await target.manager.preview(text, 'family.bumpcompanion');
    expect(preview).toMatchObject({ bumpCount: 2, invalidCount: 1, sourceLabel: 'Family list' });

    const result = await target.manager.import(text, 'family.bumpcompanion');

    expect(result).toMatchObject({ inserted: 1, merged: 0, invalid: 1 });
    expect(await target.database.count('bumps')).toBe(1);
    expect(await target.database.count('importBatches')).toBe(1);
    expect(await target.database.count('importBatchItems')).toBe(1);
    source.database.close();
    target.database.close();
  });

  it('merges imported duplicates through the production repository rules', async () => {
    const target = await createManager('merge-target');
    await target.bumps.updateBump(makeBump({ id: 'existing', latitude: 30, confidence: 0.6 }));
    const incoming = makeBump({ id: 'incoming', latitude: 30.00004, confidence: 0.95 });
    const unsigned = exportFile([incoming]);
    const checksum = await sha256Hex(serializeBumpExport(unsigned, false));

    const result = await target.manager.import(
      serializeBumpExport({ ...unsigned, checksum }),
      'nearby.bumpcompanion'
    );

    expect(result).toMatchObject({ inserted: 0, merged: 1, invalid: 0 });
    expect(await target.database.count('bumps')).toBe(1);
    expect((await target.bumps.getBump('existing'))?.confidence).toBe(0.95);
    target.database.close();
  });

  it('rejects checksum tampering before writing anything', async () => {
    const target = await createManager('tamper');
    const unsigned = exportFile([makeBump({ id: 'tamper-bump' })]);
    const checksum = await sha256Hex(serializeBumpExport(unsigned, false));
    const text = serializeBumpExport({ ...unsigned, checksum }).replace(
      '"confidence": 0.9',
      '"confidence": 0.8'
    );

    await expect(target.manager.import(text)).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH'
    });
    expect(await target.database.count('bumps')).toBe(0);
    expect(await target.database.count('importBatches')).toBe(0);
    target.database.close();
  });

  it('enforces file-size, item-count, schema, and duplicate-ID limits', async () => {
    const { database, manager } = await createManager('limits');
    await expect(manager.preview('x'.repeat(MAX_IMPORT_BYTES + 1))).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE'
    });

    const tooMany = JSON.stringify({
      schemaVersion: 1,
      appVersion: '1.0.0',
      exportId: 'limit-file',
      exportedAt: Date.now(),
      bumps: Array.from({ length: 20_001 }, (_, index) => ({
        id: `bump-${index}`,
        latitude: 30,
        longitude: 31
      }))
    });
    await expect(manager.preview(tooMany)).rejects.toMatchObject({ code: 'TOO_MANY_ITEMS' });

    await expect(
      manager.preview(JSON.stringify({ ...JSON.parse(tooMany), schemaVersion: 2, bumps: [] }))
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });

    const duplicate = exportFile([
      makeBump({ id: 'duplicate-id' }),
      makeBump({ id: 'duplicate-id', latitude: 30.02 })
    ]);
    await expect(manager.preview(serializeBumpExport(duplicate, false))).rejects.toBeInstanceOf(
      ExchangeValidationError
    );
    database.close();
  });
});

function exportFile(bumps: ReturnType<typeof makeBump>[]): BumpExportFile {
  return {
    schemaVersion: 1,
    appVersion: '1.0.0',
    exportId: crypto.randomUUID(),
    exportedAt: Date.now(),
    listName: null,
    sourceLabel: null,
    bumps,
    checksum: null
  };
}
