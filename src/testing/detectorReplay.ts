import {
  HeuristicRoadEventDetector,
  LocationQuality,
  createMotionSample,
  type DetectedRoadEvent,
  type MotionSample,
  type RoadEventDetector
} from '../core/detector';

export const DETECTOR_CSV_SCHEMA_VERSION = 2;

export const DETECTOR_CSV_HEADER = [
  'schema_version',
  'record_type',
  'elapsed_nanos',
  'epoch_millis',
  'ax',
  'ay',
  'az',
  'linear_x',
  'linear_y',
  'linear_z',
  'gravity_x',
  'gravity_y',
  'gravity_z',
  'rotation_x',
  'rotation_y',
  'rotation_z',
  'rotation_w',
  'gyro_x',
  'gyro_y',
  'gyro_z',
  'vertical',
  'longitudinal',
  'lateral',
  'world_east',
  'world_north',
  'orientation_change',
  'orientation_reliable',
  'speed',
  'speed_accuracy',
  'location_quality',
  'phone_stability',
  'event_vertical',
  'broad_vertical',
  'high_frequency',
  'envelope',
  'jerk',
  'horizontal',
  'baseline_vertical_rms',
  'baseline_high_frequency_rms',
  'road_surface',
  'detector_state',
  'latitude',
  'longitude',
  'horizontal_accuracy',
  'bearing',
  'event_type',
  'profile',
  'confidence',
  'database_confidence',
  'disposition',
  'explanation'
] as const;

export interface DetectorReplayResult {
  samplesRead: number;
  malformedRows: number;
  events: DetectedRoadEvent[];
}

interface ParsedReplaySample {
  sample: MotionSample;
  speedMetresPerSecond: number;
  locationQuality: LocationQuality;
  phoneStabilityScore: number;
  speedAccuracyMetresPerSecond: number;
}

interface ParsedReplay {
  samples: ParsedReplaySample[];
  malformedRows: number;
}

export interface TimedReplayOptions {
  detector?: RoadEventDetector;
  resetDetector?: boolean;
  /** 1 is recorded time, 2 is twice as fast, and so on. */
  speedMultiplier?: number;
  /** Injectable clock wait keeps automated tests deterministic and immediate. */
  wait?: (delayMillis: number) => Promise<void>;
}

/** Quote-aware parser compatible with Android DetectorCsvReplay. */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      result.push(field);
      field = '';
    } else {
      field += character;
    }
  }
  result.push(field);
  return result;
}

export function replayDetectorCsv(
  csv: string,
  detector: RoadEventDetector = new HeuristicRoadEventDetector(),
  resetDetector = true
): DetectorReplayResult {
  if (resetDetector) detector.reset();
  const parsed = parseReplay(csv);
  const events: DetectedRoadEvent[] = [];
  for (const row of parsed.samples) {
    const event = detector.addSample(
      row.sample,
      row.speedMetresPerSecond,
      row.locationQuality,
      row.phoneStabilityScore,
      row.speedAccuracyMetresPerSecond
    );
    if (event) events.push(event);
  }
  return {
    samplesRead: parsed.samples.length,
    malformedRows: parsed.malformedRows,
    events
  };
}

/** Replays with recorded timing or an accelerated multiplier through the same detector core. */
export async function replayDetectorCsvTimed(
  csv: string,
  options: TimedReplayOptions = {}
): Promise<DetectorReplayResult> {
  const speedMultiplier = options.speedMultiplier ?? 1;
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    throw new RangeError('speedMultiplier must be finite and greater than zero');
  }
  const detector = options.detector ?? new HeuristicRoadEventDetector();
  if (options.resetDetector ?? true) detector.reset();
  const wait =
    options.wait ??
    ((delayMillis: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMillis)));
  const parsed = parseReplay(csv);
  const events: DetectedRoadEvent[] = [];
  let previousTimestamp: number | null = null;
  for (const row of parsed.samples) {
    if (previousTimestamp !== null) {
      const delayMillis =
        Math.max(0, row.sample.elapsedRealtimeNanos - previousTimestamp) /
        1_000_000 /
        speedMultiplier;
      if (delayMillis > 0) await wait(delayMillis);
    }
    previousTimestamp = row.sample.elapsedRealtimeNanos;
    const event = detector.addSample(
      row.sample,
      row.speedMetresPerSecond,
      row.locationQuality,
      row.phoneStabilityScore,
      row.speedAccuracyMetresPerSecond
    );
    if (event) events.push(event);
  }
  return {
    samplesRead: parsed.samples.length,
    malformedRows: parsed.malformedRows,
    events
  };
}

function parseReplay(csv: string): ParsedReplay {
  const lines = csv.split(/\r?\n/);
  let firstLine = lines.shift();
  while (firstLine?.startsWith('#')) firstLine = lines.shift();
  if (firstLine === undefined) return { samples: [], malformedRows: 0 };
  const columns = parseCsvLine(firstLine);
  const indices = new Map(columns.map((column, index) => [column, index]));
  let malformedRows = 0;
  const samples: ParsedReplaySample[] = [];

  for (const line of lines) {
    if (line.trim() === '') continue;
    const values = parseCsvLine(line);
    const text = (name: string): string => values[indices.get(name) ?? -1] ?? '';
    if (text('record_type') !== 'sample') continue;
    try {
      const elapsedRealtimeNanos = requiredInteger(text('elapsed_nanos'));
      const sample = createMotionSample({
          elapsedRealtimeNanos,
          epochMillis: integerOr(text('epoch_millis'), 0),
          accelerationX: finiteOr(text('ax'), 0),
          accelerationY: finiteOr(text('ay'), 0),
          accelerationZ: finiteOr(text('az'), 0),
          linearAccelerationX: finiteOr(text('linear_x'), Number.NaN),
          linearAccelerationY: finiteOr(text('linear_y'), Number.NaN),
          linearAccelerationZ: finiteOr(text('linear_z'), Number.NaN),
          linearAccelerationAvailable: Number.isFinite(Number.parseFloat(text('linear_x'))),
          gravityX: finiteOr(text('gravity_x'), Number.NaN),
          gravityY: finiteOr(text('gravity_y'), Number.NaN),
          gravityZ: finiteOr(text('gravity_z'), Number.NaN),
          rotationVectorX: finiteOr(text('rotation_x'), Number.NaN),
          rotationVectorY: finiteOr(text('rotation_y'), Number.NaN),
          rotationVectorZ: finiteOr(text('rotation_z'), Number.NaN),
          rotationVectorW: finiteOr(text('rotation_w'), Number.NaN),
          gyroscopeX: finiteOr(text('gyro_x'), 0),
          gyroscopeY: finiteOr(text('gyro_y'), 0),
          gyroscopeZ: finiteOr(text('gyro_z'), 0),
          verticalAcceleration: finiteOr(text('vertical'), 0),
          longitudinalAcceleration: finiteOr(text('longitudinal'), 0),
          lateralAcceleration: finiteOr(text('lateral'), 0),
          worldAccelerationEast: finiteOr(text('world_east'), Number.NaN),
          worldAccelerationNorth: finiteOr(text('world_north'), Number.NaN),
          orientationChangeRadians: finiteOr(text('orientation_change'), 0),
          orientationReliable: text('orientation_reliable') === 'true'
        });
      samples.push({
        sample,
        speedMetresPerSecond: finiteOr(text('speed'), Number.NaN),
        locationQuality: parseLocationQuality(text('location_quality')),
        phoneStabilityScore: finiteOr(text('phone_stability'), 1),
        speedAccuracyMetresPerSecond: finiteOr(text('speed_accuracy'), Number.NaN)
      });
    } catch {
      malformedRows += 1;
    }
  }
  return { samples, malformedRows };
}

export function detectorCsvSampleLine(values: Partial<Record<(typeof DETECTOR_CSV_HEADER)[number], unknown>>): string {
  const row: Record<string, unknown> = {
    schema_version: DETECTOR_CSV_SCHEMA_VERSION,
    record_type: 'sample',
    ...values
  };
  return DETECTOR_CSV_HEADER.map((column) => escapeCsv(row[column])).join(',');
}

function parseLocationQuality(value: string): LocationQuality {
  return Object.values(LocationQuality).includes(value as LocationQuality)
    ? (value as LocationQuality)
    : LocationQuality.UNAVAILABLE;
}

function requiredInteger(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new TypeError('invalid integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError('unsafe integer');
  return parsed;
}

function integerOr(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteOr(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeCsv(value: unknown): string {
  let raw = '';
  if (typeof value === 'string') raw = value;
  else if (typeof value === 'number' && Number.isFinite(value)) raw = String(value);
  else if (typeof value === 'boolean' || typeof value === 'bigint') raw = String(value);
  return /[,"\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}
