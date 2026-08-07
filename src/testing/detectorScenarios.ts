import { Sensitivity } from '../core/models';
import {
  HeuristicRoadEventDetector,
  LocationQuality,
  createMotionSample,
  detectorConfigurationForSensitivity,
  type CandidateEvaluation,
  type DetectedRoadEvent,
  type DetectorConfiguration,
  type DetectorDiagnosticsListener
} from '../core/detector';

export enum PositiveKind {
  NORMAL = 'NORMAL',
  SHARP = 'SHARP',
  WIDE = 'WIDE',
  TABLE = 'TABLE',
  LOW = 'LOW',
  DOUBLE_AXLE = 'DOUBLE_AXLE',
  ASYMMETRIC = 'ASYMMETRIC'
}

export enum NegativeKind {
  POTHOLE = 'POTHOLE',
  CRACK = 'CRACK',
  ROUGH = 'ROUGH',
  BRAKING = 'BRAKING',
  TURN = 'TURN',
  PHONE = 'PHONE',
  RAMP = 'RAMP',
  JOINTS = 'JOINTS',
  STATIONARY_BUMP_SHAPE = 'STATIONARY_BUMP_SHAPE',
  ENGINE = 'ENGINE',
  RANDOM_IMPACTS = 'RANDOM_IMPACTS'
}

export interface ScenarioFrame {
  vertical: number;
  longitudinal: number;
  lateral: number;
  gyro: number;
  orientationStep: number;
  speed: number;
  quality: LocationQuality;
  stability: number;
  orientationReliable: boolean;
}

export interface PositiveContext {
  name: string;
  speed: number;
  braking: number;
  roughness: number;
  quality: LocationQuality;
  stability: number;
  orientationReliable: boolean;
}

export const POSITIVE_CONTEXTS: readonly PositiveContext[] = [
  context('10-kmh', { speed: 2.8 }),
  context('20-kmh', { speed: 5.6 }),
  context('35-kmh', { speed: 9.7 }),
  context('no-braking', { braking: 0 }),
  context('heavy-braking', { braking: -1.4 }),
  context('rough-asphalt', { roughness: 0.16 }),
  context('gps-dropout', { quality: LocationQuality.UNAVAILABLE }),
  context('gravity-fallback', { orientationReliable: false })
];

export const NEGATIVE_AMPLITUDES = [0.7, 0.85, 1, 1.15, 1.3, 1.55, 1.8] as const;

export function runSyntheticScenario(options: {
  frame: (timeSeconds: number) => Partial<ScenarioFrame>;
  configuration?: DetectorConfiguration;
  durationSeconds?: number;
  evaluationSink?: CandidateEvaluation[];
}): DetectedRoadEvent[] {
  const detector = new HeuristicRoadEventDetector(
    options.configuration ?? detectorConfigurationForSensitivity(Sensitivity.BALANCED)
  );
  if (options.evaluationSink) {
    const listener: DetectorDiagnosticsListener = {
      onCandidate: (evaluation) => options.evaluationSink!.push(evaluation)
    };
    detector.setDiagnosticsListener(listener);
  }
  const events: DetectedRoadEvent[] = [];
  const count = Math.trunc((options.durationSeconds ?? 8) * 100);
  for (let index = 0; index < count; index += 1) {
    const time = index / 100;
    const value = scenarioFrame(options.frame(time));
    const event = detector.addSample(
      createMotionSample({
        elapsedRealtimeNanos: 20_000_000_000 + index * 10_000_000,
        epochMillis: index * 10,
        accelerationX: value.lateral,
        accelerationY: value.longitudinal,
        accelerationZ: 9.80665 + value.vertical,
        gyroscopeX: value.gyro * 0.35,
        gyroscopeY: value.gyro * 0.45,
        gyroscopeZ: value.gyro,
        verticalAcceleration: value.vertical,
        longitudinalAcceleration: value.longitudinal,
        lateralAcceleration: value.lateral,
        orientationChangeRadians: value.orientationStep,
        orientationReliable: value.orientationReliable
      }),
      value.speed,
      value.quality,
      value.stability,
      value.quality === LocationQuality.GOOD ? 0.4 : Number.NaN
    );
    if (event) events.push(event);
  }
  return events;
}

export function positiveScenarioFrame(
  kind: PositiveKind,
  contextValue: PositiveContext,
  time: number
): Partial<ScenarioFrame> {
  const event = positiveWave(kind, time);
  const road =
    contextValue.roughness * Math.sin(2 * Math.PI * 11 * time) +
    contextValue.roughness * 0.55 * Math.sin(2 * Math.PI * 6.7 * time + 0.4);
  return {
    vertical: event + road,
    longitudinal:
      time >= 2 && time <= 3.8
        ? contextValue.braking
        : time >= 4.2 && time <= 5
          ? 0.25
          : 0,
    lateral: kind === PositiveKind.ASYMMETRIC ? 0.42 * gaussian(time, 3.3, 0.35) : 0.04,
    gyro: kind === PositiveKind.ASYMMETRIC ? 0.24 * gaussian(time, 3.3, 0.4) : 0.025,
    speed: contextValue.speed,
    quality: contextValue.quality,
    stability: contextValue.stability,
    orientationReliable: contextValue.orientationReliable
  };
}

export function positiveWave(kind: PositiveKind, time: number): number {
  switch (kind) {
    case PositiveKind.SHARP:
      return 5.8 * gaussian(time, 3.05, 0.055) - 4.9 * gaussian(time, 3.27, 0.075);
    case PositiveKind.WIDE:
      return 2.5 * gaussian(time, 2.85, 0.34) - 2.2 * gaussian(time, 4.05, 0.42);
    case PositiveKind.TABLE:
      return (
        3.2 * gaussian(time, 2.75, 0.13) -
        2.7 * gaussian(time, 3.1, 0.16) +
        2.7 * gaussian(time, 4.15, 0.15) -
        2.9 * gaussian(time, 4.48, 0.17)
      );
    case PositiveKind.LOW:
      return 1.55 * gaussian(time, 3.05, 0.17) - 1.35 * gaussian(time, 3.48, 0.19);
    case PositiveKind.DOUBLE_AXLE:
      return normalBump(time, 3) + 0.58 * normalBump(time, 3.68);
    case PositiveKind.ASYMMETRIC:
      return 3.7 * gaussian(time, 3, 0.15) - 3.1 * gaussian(time, 3.44, 0.22);
    case PositiveKind.NORMAL:
    default:
      return normalBump(time, 3.2);
  }
}

export function negativeScenarioFrame(
  kind: NegativeKind,
  time: number,
  scale: number
): Partial<ScenarioFrame> {
  switch (kind) {
    case NegativeKind.POTHOLE:
      return {
        vertical:
          -7.2 * scale * gaussian(time, 3, 0.035) +
          1.25 * scale * gaussian(time, 3.13, 0.1),
        lateral: 1.4 * gaussian(time, 3, 0.08),
        gyro: 0.65 * gaussian(time, 3, 0.1)
      };
    case NegativeKind.CRACK:
      return {
        vertical:
          3.8 * scale * gaussian(time, 3, 0.018) - 1.1 * gaussian(time, 3.06, 0.025)
      };
    case NegativeKind.ROUGH:
      return {
        vertical:
          scale *
          (0.95 * Math.sin(2 * Math.PI * 12 * time) +
            0.65 * Math.sin(2 * Math.PI * 7.3 * time + 0.7)),
        lateral: 0.7 * Math.sin(2 * Math.PI * 9.1 * time),
        gyro: 0.24
      };
    case NegativeKind.BRAKING:
      return {
        longitudinal: -2.5 * scale * gaussian(time, 3.3, 0.8),
        speed: Math.max(1, 7 - 4 * gaussian(time, 3.4, 0.9))
      };
    case NegativeKind.TURN:
      return {
        vertical: 0.18 * Math.sin(2 * Math.PI * 2 * time),
        lateral: 3.5 * scale * gaussian(time, 3.4, 0.9),
        gyro: 0.75 * scale * gaussian(time, 3.4, 0.9)
      };
    case NegativeKind.PHONE:
      return {
        vertical:
          3.5 *
          scale *
          Math.sin(2 * Math.PI * 1.8 * (time - 2.7)) *
          (time >= 2.7 && time <= 4.1 ? 1 : 0),
        lateral: 5 * scale * Math.sin(2 * Math.PI * 1.4 * time),
        gyro: 3.2,
        orientationStep: 0.22,
        stability: 0.12
      };
    case NegativeKind.RAMP:
      return {
        vertical: 0.9 * scale * Math.max(0, Math.sin(Math.PI * ((time - 2) / 4))),
        gyro: 0.13,
        orientationStep: 0.035
      };
    case NegativeKind.JOINTS:
      return {
        vertical:
          (2.8 * gaussian(time, 2.8, 0.018) -
            2.5 * gaussian(time, 2.85, 0.02) +
            2.7 * gaussian(time, 3.25, 0.018) -
            2.4 * gaussian(time, 3.3, 0.02)) *
          scale
      };
    case NegativeKind.STATIONARY_BUMP_SHAPE:
      return { vertical: normalBump(time, 3.2) * scale, speed: 0 };
    case NegativeKind.ENGINE:
      return {
        vertical: 0.9 * scale * Math.sin(2 * Math.PI * 18 * time),
        gyro: 0.08,
        speed: 0
      };
    case NegativeKind.RANDOM_IMPACTS:
      return {
        vertical:
          scale *
          (3.2 * gaussian(time, 2.5, 0.025) -
            4 * gaussian(time, 3.1, 0.03) +
            2.8 * gaussian(time, 3.42, 0.025) -
            3.5 * gaussian(time, 4, 0.022)),
        lateral: 0.9 * Math.sin(2 * Math.PI * 3 * time),
        gyro: 0.5
      };
  }
}

export interface NamedScenarioMapping {
  name: string;
  expected: 'bump' | 'rejected';
  variant: PositiveKind | NegativeKind | 'SEPARATED_BUMPS';
  note: string;
}

/** Every scenario explicitly requested for the web release, mapped to a deterministic family. */
export const USER_SCENARIO_CATALOG: readonly NamedScenarioMapping[] = [
  map('normal speed bump', 'bump', PositiveKind.NORMAL),
  map('small bump', 'bump', PositiveKind.LOW),
  map('sharp bump', 'bump', PositiveKind.SHARP),
  map('large bump', 'bump', PositiveKind.NORMAL),
  map('wide hump', 'bump', PositiveKind.WIDE),
  map('raised table', 'bump', PositiveKind.TABLE),
  map('low-speed crossing', 'bump', PositiveKind.NORMAL),
  map('moderate-speed crossing', 'bump', PositiveKind.NORMAL),
  map('no braking', 'bump', PositiveKind.NORMAL),
  map('heavy braking', 'bump', PositiveKind.NORMAL),
  map('bump on rough road', 'bump', PositiveKind.NORMAL),
  map('consecutive bumps', 'bump', 'SEPARATED_BUMPS'),
  map('asymmetric bump', 'bump', PositiveKind.ASYMMETRIC),
  map('pothole', 'rejected', NegativeKind.POTHOLE),
  map('multiple potholes', 'rejected', NegativeKind.RANDOM_IMPACTS),
  map('rough asphalt', 'rejected', NegativeKind.ROUGH),
  map('short rough patch', 'rejected', NegativeKind.ROUGH),
  map('sustained rough road', 'rejected', NegativeKind.ROUGH),
  map('cracks', 'rejected', NegativeKind.CRACK),
  map('bridge joint', 'rejected', NegativeKind.JOINTS),
  map('expansion joint', 'rejected', NegativeKind.JOINTS),
  map('manhole cover', 'rejected', NegativeKind.JOINTS),
  map('gravel', 'rejected', NegativeKind.ROUGH),
  map('cobblestone', 'rejected', NegativeKind.ROUGH),
  map('hard braking', 'rejected', NegativeKind.BRAKING),
  map('acceleration', 'rejected', NegativeKind.BRAKING),
  map('brake then accelerate', 'rejected', NegativeKind.BRAKING),
  map('turn', 'rejected', NegativeKind.TURN),
  map('roundabout', 'rejected', NegativeKind.TURN),
  map('lane change', 'rejected', NegativeKind.TURN),
  map('hill', 'rejected', NegativeKind.RAMP),
  map('ramp', 'rejected', NegativeKind.RAMP),
  map('phone movement', 'rejected', NegativeKind.PHONE),
  map('phone being picked up', 'rejected', NegativeKind.PHONE),
  map('device rotation', 'rejected', NegativeKind.PHONE),
  map('repeated vibration', 'rejected', NegativeKind.ENGINE)
];

export function normalBump(time: number, centre: number): number {
  return 4.6 * gaussian(time, centre, 0.14) - 3.9 * gaussian(time, centre + 0.38, 0.17);
}

export function gaussian(time: number, centre: number, width: number): number {
  const delta = time - centre;
  return Math.exp(-(delta * delta) / (2 * width * width));
}

function scenarioFrame(overrides: Partial<ScenarioFrame>): ScenarioFrame {
  return {
    vertical: 0,
    longitudinal: 0,
    lateral: 0.03,
    gyro: 0.02,
    orientationStep: 0.002,
    speed: 7,
    quality: LocationQuality.GOOD,
    stability: 0.96,
    orientationReliable: true,
    ...overrides
  };
}

function context(name: string, overrides: Partial<Omit<PositiveContext, 'name'>>): PositiveContext {
  return {
    name,
    speed: 7,
    braking: -0.35,
    roughness: 0,
    quality: LocationQuality.GOOD,
    stability: 0.96,
    orientationReliable: true,
    ...overrides
  };
}

function map(
  name: string,
  expected: NamedScenarioMapping['expected'],
  variant: NamedScenarioMapping['variant']
): NamedScenarioMapping {
  return { name, expected, variant, note: 'Mapped to the closest deterministic detector-v2 physics family.' };
}
