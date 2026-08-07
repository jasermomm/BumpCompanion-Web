import {
  deleteDB,
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction
} from 'idb';
import type {
  AppSettings,
  CalibrationProfile,
  CandidateEvent,
  DriveSession,
  EncounterSummary,
  LocationTrackPoint,
  SpeedBump
} from '../core/models';

export const DATABASE_NAME = 'bumpcompanion-web';
export const DATABASE_VERSION = 3;

export const STORE_NAMES = {
  settings: 'settings',
  bumps: 'bumps',
  candidates: 'candidates',
  drives: 'drives',
  encounters: 'encounters',
  routePoints: 'routePoints',
  calibrations: 'calibrations',
  importBatches: 'importBatches',
  importBatchItems: 'importBatchItems',
  meta: 'meta'
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];
const ALL_STORE_NAMES = [
  STORE_NAMES.settings,
  STORE_NAMES.bumps,
  STORE_NAMES.candidates,
  STORE_NAMES.drives,
  STORE_NAMES.encounters,
  STORE_NAMES.routePoints,
  STORE_NAMES.calibrations,
  STORE_NAMES.importBatches,
  STORE_NAMES.importBatchItems,
  STORE_NAMES.meta
] as const;

export interface SettingsRecord {
  key: 'app';
  value: AppSettings;
  updatedAt: number;
}

export interface ImportBatchRecord {
  id: string;
  importedAt: number;
  sourceName: string;
  fileName: string;
  schemaVersion: number;
  insertedCount: number;
  mergedCount: number;
  invalidCount: number;
  undone: boolean;
}

export interface ImportBatchItemRecord {
  batchId: string;
  bumpId: string;
  createdNew: boolean;
}

export interface MetaRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}

export interface BumpCompanionSchema extends DBSchema {
  settings: {
    key: string;
    value: SettingsRecord;
  };
  bumps: {
    key: string;
    value: SpeedBump;
    indexes: {
      'by-status': string;
      'by-last-detected': number;
      'by-imported-source': string;
      'by-latitude': number;
      'by-coordinate': [number, number];
    };
  };
  candidates: {
    key: string;
    value: CandidateEvent;
    indexes: {
      'by-drive': string;
      'by-decision': string;
      'by-detected-at': number;
    };
  };
  drives: {
    key: string;
    value: DriveSession;
    indexes: {
      'by-started-at': number;
    };
  };
  encounters: {
    key: string;
    value: EncounterSummary;
    indexes: {
      'by-bump': string;
      'by-candidate': string;
      'by-drive': string;
      'by-encountered-at': number;
    };
  };
  routePoints: {
    key: [string, number];
    value: LocationTrackPoint;
    indexes: {
      'by-drive': string;
      'by-epoch': number;
    };
  };
  calibrations: {
    key: string;
    value: CalibrationProfile;
    indexes: {
      'by-created-at': number;
    };
  };
  importBatches: {
    key: string;
    value: ImportBatchRecord;
    indexes: {
      'by-imported-at': number;
    };
  };
  importBatchItems: {
    key: [string, string];
    value: ImportBatchItemRecord;
    indexes: {
      'by-batch': string;
      'by-bump': string;
    };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

export type BumpDatabase = IDBPDatabase<BumpCompanionSchema>;
export type BumpTransaction<Names extends StoreName> = IDBPTransaction<
  BumpCompanionSchema,
  Names[],
  'readwrite'
>;

let defaultDatabase: Promise<BumpDatabase> | null = null;

export function openBumpDatabase(
  name = DATABASE_NAME,
  version = DATABASE_VERSION
): Promise<BumpDatabase> {
  if (!Number.isInteger(version) || version < 1 || version > DATABASE_VERSION) {
    return Promise.reject(new RangeError(`Unsupported database version: ${version}`));
  }
  return openDB<BumpCompanionSchema>(name, version, {
    upgrade(database, oldVersion, newVersion, transaction) {
      const targetVersion = newVersion ?? version;
      if (oldVersion < 1 && targetVersion >= 1) migrateToVersion1(database);
      if (oldVersion < 2 && targetVersion >= 2) migrateToVersion2(database);
      if (oldVersion < 3 && targetVersion >= 3) migrateToVersion3(database, transaction);
    }
  });
}

export function getDatabase(): Promise<BumpDatabase> {
  defaultDatabase ??= openBumpDatabase();
  return defaultDatabase;
}

export async function closeDefaultDatabase(): Promise<void> {
  const pending = defaultDatabase;
  defaultDatabase = null;
  if (pending) (await pending).close();
}

export async function deleteBumpDatabase(name = DATABASE_NAME): Promise<void> {
  if (name === DATABASE_NAME) await closeDefaultDatabase();
  await deleteDB(name);
}

export async function clearAllLocalData(database: BumpDatabase): Promise<void> {
  const transaction = database.transaction(ALL_STORE_NAMES, 'readwrite');
  await Promise.all(
    ALL_STORE_NAMES.map((name) => transaction.objectStore(name).clear())
  );
  await transaction.done;
}

function migrateToVersion1(database: BumpDatabase): void {
  database.createObjectStore(STORE_NAMES.settings, { keyPath: 'key' });

  const bumps = database.createObjectStore(STORE_NAMES.bumps, { keyPath: 'id' });
  bumps.createIndex('by-status', 'status');
  bumps.createIndex('by-last-detected', 'lastDetectedAt');
  bumps.createIndex('by-latitude', 'latitude');

  const candidates = database.createObjectStore(STORE_NAMES.candidates, { keyPath: 'id' });
  candidates.createIndex('by-drive', 'driveId');
  candidates.createIndex('by-decision', 'decision');
  candidates.createIndex('by-detected-at', 'detectedAt');

  const drives = database.createObjectStore(STORE_NAMES.drives, { keyPath: 'id' });
  drives.createIndex('by-started-at', 'startedAt');

  const encounters = database.createObjectStore(STORE_NAMES.encounters, { keyPath: 'id' });
  encounters.createIndex('by-bump', 'bumpId');
  encounters.createIndex('by-candidate', 'candidateId');
  encounters.createIndex('by-drive', 'driveId');
  encounters.createIndex('by-encountered-at', 'encounteredAt');

  const calibrations = database.createObjectStore(STORE_NAMES.calibrations, { keyPath: 'id' });
  calibrations.createIndex('by-created-at', 'createdAt');

  const batches = database.createObjectStore(STORE_NAMES.importBatches, { keyPath: 'id' });
  batches.createIndex('by-imported-at', 'importedAt');

  const batchItems = database.createObjectStore(STORE_NAMES.importBatchItems, {
    keyPath: ['batchId', 'bumpId']
  });
  batchItems.createIndex('by-batch', 'batchId');
  batchItems.createIndex('by-bump', 'bumpId');
}

function migrateToVersion2(database: BumpDatabase): void {
  const routePoints = database.createObjectStore(STORE_NAMES.routePoints, {
    keyPath: ['driveId', 'elapsedRealtimeNanos']
  });
  routePoints.createIndex('by-drive', 'driveId');
  routePoints.createIndex('by-epoch', 'epochMillis');
}

function migrateToVersion3(
  database: BumpDatabase,
  transaction: IDBPTransaction<
    BumpCompanionSchema,
    StoreName[],
    'versionchange'
  >
): void {
  database.createObjectStore(STORE_NAMES.meta, { keyPath: 'key' });
  const bumps = transaction.objectStore(STORE_NAMES.bumps);
  if (!bumps.indexNames.contains('by-imported-source')) {
    bumps.createIndex('by-imported-source', 'importedSource');
  }
  if (!bumps.indexNames.contains('by-coordinate')) {
    bumps.createIndex('by-coordinate', ['latitude', 'longitude']);
  }
}
