import {
  BumpSource,
  BumpStatus,
  Directionality,
  createId,
  type SpeedBump
} from '../core/models';
import { mergeSpeedBump } from './bumpRepository';
import {
  getDatabase,
  type BumpDatabase,
  type ImportBatchItemRecord,
  type ImportBatchRecord
} from './database';
import { sha256Hex } from './sha256';

export const BUMP_EXCHANGE_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ITEMS = 20_000;

export interface BumpExportFile {
  schemaVersion: number;
  appVersion: string;
  exportId: string;
  exportedAt: number;
  listName: string | null;
  sourceLabel: string | null;
  bumps: SpeedBump[];
  checksum: string | null;
}

export interface ExportArtifact {
  file: BumpExportFile;
  text: string;
  blob: Blob;
  count: number;
}

export interface ImportPreview {
  fileName: string;
  exportedAt: number;
  bumpCount: number;
  sourceLabel: string | null;
  invalidCount: number;
  coordinateBounds: string;
}

export interface ImportResult {
  inserted: number;
  merged: number;
  invalid: number;
  errors: string[];
  batchId: string | null;
}

export class ExchangeValidationError extends Error {
  constructor(
    readonly code:
      | 'FILE_TOO_LARGE'
      | 'MALFORMED_JSON'
      | 'UNSUPPORTED_SCHEMA'
      | 'TOO_MANY_ITEMS'
      | 'INVALID_IDENTIFIER'
      | 'INVALID_TIMESTAMP'
      | 'FIELD_TOO_LONG'
      | 'DUPLICATE_IDS'
      | 'CHECKSUM_MISMATCH'
      | 'INVALID_FILE',
    message: string
  ) {
    super(message);
    this.name = 'ExchangeValidationError';
  }
}

type ExchangeInput = Blob | ArrayBuffer | Uint8Array | string;

export class BumpExchangeManager {
  constructor(
    private readonly database: BumpDatabase | Promise<BumpDatabase> = getDatabase(),
    private readonly appVersion = '1.0.0'
  ) {}

  async createExport(
    listName: string | null = null,
    sourceLabel: string | null = null
  ): Promise<ExportArtifact> {
    if (listName !== null && listName.length > 160) {
      throw new ExchangeValidationError('FIELD_TOO_LONG', 'The list name is too long.');
    }
    if (sourceLabel !== null && sourceLabel.length > 160) {
      throw new ExchangeValidationError('FIELD_TOO_LONG', 'The source label is too long.');
    }
    const database = await this.database;
    const allBumps = await database.getAll('bumps');
    const bumps = allBumps
      .filter(
        (bump) =>
          (bump.status === BumpStatus.CONFIRMED || bump.status === BumpStatus.IMPORTED) &&
          !bump.archived &&
          !bump.markedRemoved
      )
      .sort((first, second) => second.lastDetectedAt - first.lastDetectedAt)
      .map(sanitiseExportBump);
    const unsigned: BumpExportFile = {
      schemaVersion: BUMP_EXCHANGE_SCHEMA_VERSION,
      appVersion: this.appVersion,
      exportId: createId(),
      exportedAt: Date.now(),
      listName,
      sourceLabel,
      bumps,
      checksum: null
    };
    const checksum = await sha256Hex(serializeBumpExport(unsigned, false));
    const file = { ...unsigned, checksum };
    const text = serializeBumpExport(file, true);
    return {
      file,
      text,
      blob: new Blob([text], { type: 'application/json' }),
      count: bumps.length
    };
  }

  async preview(input: ExchangeInput, fileName = 'Imported file'): Promise<ImportPreview> {
    const file = await this.readAndValidate(input);
    const valid = file.bumps.filter(isValidBump);
    const coordinateBounds =
      valid.length === 0
        ? 'No valid coordinates'
        : `${Math.min(...valid.map((bump) => bump.latitude)).toFixed(4)}…${Math.max(
            ...valid.map((bump) => bump.latitude)
          ).toFixed(4)}, ${Math.min(...valid.map((bump) => bump.longitude)).toFixed(
            4
          )}…${Math.max(...valid.map((bump) => bump.longitude)).toFixed(4)}`;
    return {
      fileName: fileName.slice(-80) || 'Imported file',
      exportedAt: file.exportedAt,
      bumpCount: file.bumps.length,
      sourceLabel: file.sourceLabel,
      invalidCount: file.bumps.length - valid.length,
      coordinateBounds
    };
  }

  async import(
    input: ExchangeInput,
    fileName = 'Imported file',
    sourceName: string | null = null
  ): Promise<ImportResult> {
    const file = await this.readAndValidate(input);
    const resolvedSource = (sourceName ?? file.sourceLabel ?? 'Imported list').slice(0, 120);
    const batchId = createId();
    let inserted = 0;
    let merged = 0;
    let invalid = 0;
    const errors: string[] = [];
    const database = await this.database;
    const transaction = database.transaction(
      ['bumps', 'importBatches', 'importBatchItems'],
      'readwrite'
    );

    try {
      const bumpStore = transaction.objectStore('bumps');
      const existing = await bumpStore.getAll();
      const working = [...existing];
      const batchItems = new Map<string, ImportBatchItemRecord>();

      for (const [index, item] of file.bumps.entries()) {
        if (!isValidBump(item)) {
          invalid += 1;
          if (errors.length < 10) errors.push(`Item ${index + 1} has invalid coordinates or fields.`);
          continue;
        }
        const sanitised: SpeedBump = {
          ...item,
          id: item.id.length >= 8 && item.id.length <= 100 ? item.id : createId(),
          source: BumpSource.IMPORTED,
          status: BumpStatus.IMPORTED,
          importedSource: resolvedSource,
          notes: item.notes.slice(0, 2_000),
          roadName: item.roadName?.slice(0, 160) ?? null,
          regionLabel: item.regionLabel?.slice(0, 160) ?? null,
          archived: false,
          markedRemoved: false
        };
        const result = mergeSpeedBump(sanitised, working);
        await bumpStore.put(result.bump);
        if (result.createdNew) {
          working.push(result.bump);
          inserted += 1;
        } else {
          const existingIndex = working.findIndex((bump) => bump.id === result.bump.id);
          if (existingIndex >= 0) working[existingIndex] = result.bump;
          merged += 1;
        }
        batchItems.set(result.bump.id, {
          batchId,
          bumpId: result.bump.id,
          createdNew: result.createdNew
        });
      }

      const batch: ImportBatchRecord = {
        id: batchId,
        importedAt: Date.now(),
        sourceName: resolvedSource,
        fileName: (fileName.slice(-160) || 'Imported file').slice(0, 160),
        schemaVersion: file.schemaVersion,
        insertedCount: inserted,
        mergedCount: merged,
        invalidCount: invalid,
        undone: false
      };
      await transaction.objectStore('importBatches').put(batch);
      for (const item of batchItems.values()) {
        await transaction.objectStore('importBatchItems').put(item);
      }
      await transaction.done;
    } catch (error) {
      transaction.abort();
      throw error;
    }

    return { inserted, merged, invalid, errors, batchId };
  }

  async readAndValidate(input: ExchangeInput): Promise<BumpExportFile> {
    const text = await readText(input);
    const byteLength = new TextEncoder().encode(text).byteLength;
    if (byteLength > MAX_IMPORT_BYTES) {
      throw new ExchangeValidationError('FILE_TOO_LARGE', 'The import file exceeds 5 MB.');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ExchangeValidationError('MALFORMED_JSON', 'The import file is not valid JSON.');
    }
    const file = decodeExportFile(raw);
    if (file.schemaVersion < 1 || file.schemaVersion > BUMP_EXCHANGE_SCHEMA_VERSION) {
      throw new ExchangeValidationError(
        'UNSUPPORTED_SCHEMA',
        `Unsupported schema version: ${file.schemaVersion}.`
      );
    }
    if (file.bumps.length > MAX_IMPORT_ITEMS) {
      throw new ExchangeValidationError('TOO_MANY_ITEMS', 'The import contains too many items.');
    }
    if (file.exportId.length < 1 || file.exportId.length > 100) {
      throw new ExchangeValidationError('INVALID_IDENTIFIER', 'The export identifier is invalid.');
    }
    if (file.exportedAt < 0 || file.exportedAt > Date.now() + 86_400_000) {
      throw new ExchangeValidationError('INVALID_TIMESTAMP', 'The export timestamp is invalid.');
    }
    if ((file.listName?.length ?? 0) > 160 || (file.sourceLabel?.length ?? 0) > 160) {
      throw new ExchangeValidationError('FIELD_TOO_LONG', 'An import label is too long.');
    }
    if (new Set(file.bumps.map((bump) => bump.id)).size !== file.bumps.length) {
      throw new ExchangeValidationError(
        'DUPLICATE_IDS',
        'The import contains duplicate identifiers.'
      );
    }
    if (file.checksum !== null) {
      const expected = await sha256Hex(serializeBumpExport({ ...file, checksum: null }, false));
      if (expected.toLowerCase() !== file.checksum.toLowerCase()) {
        throw new ExchangeValidationError(
          'CHECKSUM_MISMATCH',
          'The import checksum does not match.'
        );
      }
    }
    return file;
  }
}

export function serializeBumpExport(file: BumpExportFile, includeChecksum = true): string {
  const ordered: Record<string, unknown> = {
    schemaVersion: file.schemaVersion,
    appVersion: file.appVersion,
    exportId: file.exportId,
    exportedAt: file.exportedAt
  };
  if (file.listName !== null) ordered.listName = file.listName;
  if (file.sourceLabel !== null) ordered.sourceLabel = file.sourceLabel;
  ordered.bumps = file.bumps.map(orderedBump);
  if (includeChecksum && file.checksum !== null) ordered.checksum = file.checksum;

  const standard = JSON.stringify(ordered, null, 4);
  return applyKotlinFloatingPointFormatting(standard);
}

function orderedBump(bump: SpeedBump): Record<string, unknown> {
  const ordered: Record<string, unknown> = {
    id: bump.id,
    latitude: bump.latitude,
    longitude: bump.longitude,
    rawLatitude: bump.rawLatitude,
    rawLongitude: bump.rawLongitude,
    horizontalAccuracyMetres: bump.horizontalAccuracyMetres,
    coordinateConfidence: bump.coordinateConfidence,
    confidence: bump.confidence,
    status: bump.status,
    source: bump.source,
    directionality: bump.directionality
  };
  if (bump.primaryBearing !== null) ordered.primaryBearing = bump.primaryBearing;
  if (bump.oppositeBearing !== null) ordered.oppositeBearing = bump.oppositeBearing;
  ordered.bearingTolerance = bump.bearingTolerance;
  ordered.firstDetectedAt = bump.firstDetectedAt;
  ordered.lastDetectedAt = bump.lastDetectedAt;
  if (bump.lastWarnedAt !== null) ordered.lastWarnedAt = bump.lastWarnedAt;
  ordered.encounterCount = bump.encounterCount;
  ordered.confirmationCount = bump.confirmationCount;
  ordered.rejectionCount = bump.rejectionCount;
  ordered.missingReports = bump.missingReports;
  if (bump.importedSource !== null) ordered.importedSource = bump.importedSource;
  ordered.notes = bump.notes;
  ordered.warningEnabled = bump.warningEnabled;
  if (bump.customWarningDistanceMetres !== null) {
    ordered.customWarningDistanceMetres = bump.customWarningDistanceMetres;
  }
  ordered.algorithmVersion = bump.algorithmVersion;
  ordered.archived = bump.archived;
  ordered.markedRemoved = bump.markedRemoved;
  if (bump.regionLabel !== null) ordered.regionLabel = bump.regionLabel;
  if (bump.roadName !== null) ordered.roadName = bump.roadName;
  return ordered;
}

const FLOATING_FIELDS = new Set([
  'latitude',
  'longitude',
  'rawLatitude',
  'rawLongitude',
  'horizontalAccuracyMetres',
  'coordinateConfidence',
  'confidence',
  'primaryBearing',
  'oppositeBearing',
  'bearingTolerance'
]);

function applyKotlinFloatingPointFormatting(json: string): string {
  return json
    .split('\n')
    .map((line) => {
      const match = line.match(/^(\s*)"([^"]+)": (-?(?:\d+(?:\.\d+)?|\d*\.\d+)(?:e[+-]?\d+)?)(,?)$/i);
      if (!match || !FLOATING_FIELDS.has(match[2])) return line;
      return `${match[1]}"${match[2]}": ${formatKotlinNumber(match[3])}${match[4]}`;
    })
    .join('\n');
}

function formatKotlinNumber(token: string): string {
  let normalized = token.replace('e', 'E');
  const exponentIndex = normalized.indexOf('E');
  if (exponentIndex >= 0) {
    const mantissa = normalized.slice(0, exponentIndex);
    const exponent = normalized.slice(exponentIndex + 1).replace(/^\+/, '');
    normalized = `${mantissa.includes('.') ? mantissa : `${mantissa}.0`}E${exponent}`;
  } else if (!normalized.includes('.')) {
    normalized += '.0';
  }
  return normalized;
}

function sanitiseExportBump(bump: SpeedBump): SpeedBump {
  return {
    ...bump,
    horizontalAccuracyMetres: Number.isFinite(bump.horizontalAccuracyMetres)
      ? bump.horizontalAccuracyMetres
      : 999,
    confidence: clamp(bump.confidence, 0, 1),
    coordinateConfidence: clamp(bump.coordinateConfidence, 0, 1)
  };
}

function isValidBump(bump: SpeedBump): boolean {
  return (
    Number.isFinite(bump.latitude) &&
    bump.latitude >= -90 &&
    bump.latitude <= 90 &&
    Number.isFinite(bump.longitude) &&
    bump.longitude >= -180 &&
    bump.longitude <= 180 &&
    Number.isFinite(bump.rawLatitude) &&
    bump.rawLatitude >= -90 &&
    bump.rawLatitude <= 90 &&
    Number.isFinite(bump.rawLongitude) &&
    bump.rawLongitude >= -180 &&
    bump.rawLongitude <= 180 &&
    Number.isFinite(bump.horizontalAccuracyMetres) &&
    bump.horizontalAccuracyMetres >= 0 &&
    bump.horizontalAccuracyMetres <= 10_000 &&
    Number.isFinite(bump.confidence) &&
    bump.confidence >= 0 &&
    bump.confidence <= 1 &&
    Number.isFinite(bump.coordinateConfidence) &&
    bump.coordinateConfidence >= 0 &&
    bump.coordinateConfidence <= 1 &&
    bump.notes.length <= 10_000 &&
    (bump.customWarningDistanceMetres === null ||
      (Number.isInteger(bump.customWarningDistanceMetres) &&
        bump.customWarningDistanceMetres >= 10 &&
        bump.customWarningDistanceMetres <= 1_000))
  );
}

async function readText(input: ExchangeInput): Promise<string> {
  if (typeof input === 'string') return input;
  if (input instanceof Blob) {
    if (input.size > MAX_IMPORT_BYTES) {
      throw new ExchangeValidationError('FILE_TOO_LARGE', 'The import file exceeds 5 MB.');
    }
    return input.text();
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ExchangeValidationError('FILE_TOO_LARGE', 'The import file exceeds 5 MB.');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function decodeExportFile(value: unknown): BumpExportFile {
  const record = asRecord(value, 'The import file has an invalid top-level object.');
  const bumpsRaw = record.bumps;
  if (!Array.isArray(bumpsRaw)) {
    throw new ExchangeValidationError('INVALID_FILE', 'The import file has no bump list.');
  }
  return {
    schemaVersion: requiredInteger(record.schemaVersion, 'schemaVersion'),
    appVersion: requiredString(record.appVersion, 'appVersion'),
    exportId: requiredString(record.exportId, 'exportId'),
    exportedAt: requiredInteger(record.exportedAt, 'exportedAt'),
    listName: optionalString(record.listName, 'listName'),
    sourceLabel: optionalString(record.sourceLabel, 'sourceLabel'),
    bumps: bumpsRaw.map((bump, index) => decodeBump(bump, index)),
    checksum: optionalString(record.checksum, 'checksum')
  };
}

function decodeBump(value: unknown, index: number): SpeedBump {
  const record = asRecord(value, `Bump ${index + 1} is not an object.`);
  const latitude = requiredNumber(record.latitude, 'latitude');
  const longitude = requiredNumber(record.longitude, 'longitude');
  const now = Date.now();
  return {
    id: requiredString(record.id, 'id'),
    latitude,
    longitude,
    rawLatitude: numberOr(record.rawLatitude, latitude),
    rawLongitude: numberOr(record.rawLongitude, longitude),
    horizontalAccuracyMetres: numberOr(record.horizontalAccuracyMetres, 999),
    coordinateConfidence: numberOr(record.coordinateConfidence, 0.5),
    confidence: numberOr(record.confidence, 0.5),
    status: enumValue(record.status, BumpStatus, BumpStatus.CONFIRMED),
    source: enumValue(record.source, BumpSource, BumpSource.IMPORTED),
    directionality: enumValue(
      record.directionality,
      Directionality,
      Directionality.UNKNOWN
    ),
    primaryBearing: nullableNumber(record.primaryBearing),
    oppositeBearing: nullableNumber(record.oppositeBearing),
    bearingTolerance: numberOr(record.bearingTolerance, 45),
    firstDetectedAt: integerOr(record.firstDetectedAt, now),
    lastDetectedAt: integerOr(record.lastDetectedAt, now),
    lastWarnedAt: nullableInteger(record.lastWarnedAt),
    encounterCount: integerOr(record.encounterCount, 1),
    confirmationCount: integerOr(record.confirmationCount, 1),
    rejectionCount: integerOr(record.rejectionCount, 0),
    missingReports: integerOr(record.missingReports, 0),
    importedSource: optionalString(record.importedSource, 'importedSource'),
    notes: stringOr(record.notes, ''),
    warningEnabled: booleanOr(record.warningEnabled, true),
    customWarningDistanceMetres: nullableInteger(record.customWarningDistanceMetres),
    algorithmVersion: integerOr(record.algorithmVersion, 2),
    archived: booleanOr(record.archived, false),
    markedRemoved: booleanOr(record.markedRemoved, false),
    regionLabel: optionalString(record.regionLabel, 'regionLabel'),
    roadName: optionalString(record.roadName, 'roadName')
  };
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExchangeValidationError('INVALID_FILE', message);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') invalidField(field);
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requiredString(value, field);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidField(field);
  return value;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredInteger(value: unknown, field: string): number {
  const result = requiredNumber(value, field);
  if (!Number.isSafeInteger(result)) invalidField(field);
  return result;
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function enumValue<T extends string>(
  value: unknown,
  enumeration: Record<string, T>,
  fallback: T
): T {
  return typeof value === 'string' && Object.values(enumeration).includes(value as T)
    ? (value as T)
    : fallback;
}

function invalidField(field: string): never {
  throw new ExchangeValidationError('INVALID_FILE', `The ${field} field is invalid.`);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
