import { describe, expect, it } from 'vitest';
import { Sensitivity } from '../../src/core/models';
import {
  HeuristicRoadEventDetector,
  LocationQuality,
  RoadEventType,
  createMotionSample,
  detectorConfigurationForSensitivity,
  type CandidateEvaluation
} from '../../src/core/detector';
import {
  NEGATIVE_AMPLITUDES,
  POSITIVE_CONTEXTS,
  USER_SCENARIO_CATALOG,
  NegativeKind,
  PositiveKind,
  negativeScenarioFrame,
  normalBump,
  positiveScenarioFrame,
  runSyntheticScenario
} from '../../src/testing/detectorScenarios';

describe('detector-v2 synthetic scenario matrix', () => {
  it('retains all 56 Android positive variants', () => {
    const failures: string[] = [];
    for (const kind of Object.values(PositiveKind)) {
      for (const context of POSITIVE_CONTEXTS) {
        const evaluations: CandidateEvaluation[] = [];
        const sensitivity = kind === PositiveKind.LOW ? Sensitivity.SENSITIVE : Sensitivity.BALANCED;
        const events = runSyntheticScenario({
          configuration: detectorConfigurationForSensitivity(sensitivity),
          evaluationSink: evaluations,
          frame: (time) => positiveScenarioFrame(kind, context, time)
        });
        if (events.length === 0) {
          failures.push(`${kind}/${context.name}: ${evaluations.at(-1)?.explanation ?? 'no candidate'}`);
        }
      }
    }
    expect(Object.values(PositiveKind).length * POSITIVE_CONTEXTS.length).toBe(56);
    expect(failures).toEqual([]);
  });

  it('rejects all 77 Android adversarial non-bump variants', () => {
    const failures: string[] = [];
    for (const kind of Object.values(NegativeKind)) {
      for (const scale of NEGATIVE_AMPLITUDES) {
        const events = runSyntheticScenario({
          frame: (time) => negativeScenarioFrame(kind, time, scale)
        });
        if (events.length > 0) {
          failures.push(`${kind}/scale-${scale}: ${events[0].confidence}, ${events[0].profile}`);
        }
      }
    }
    expect(Object.values(NegativeKind).length * NEGATIVE_AMPLITUDES.length).toBe(77);
    expect(failures).toEqual([]);
  });

  it('groups front/rear axle response but detects separated bumps', () => {
    const axleEvents = runSyntheticScenario({
      frame: (time) => ({
        vertical:
          normalBump(time, 3) +
          0.58 * normalBump(time, 3.68)
      })
    });
    expect(axleEvents).toHaveLength(1);

    const separated = runSyntheticScenario({
      durationSeconds: 10,
      frame: (time) => ({
        vertical: normalBump(time, 2.6) + normalBump(time, 6.4)
      })
    });
    expect(separated).toHaveLength(2);
  });

  it('bridges a temporary GPS dropout from recent moving evidence', () => {
    const events = runSyntheticScenario({
      frame: (time) => ({
        vertical: normalBump(time, 3.2),
        speed: time < 2.2 ? 6 : 0,
        quality: time < 2.2 ? LocationQuality.GOOD : LocationQuality.UNAVAILABLE
      })
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('keeps rejected candidate explanations complete and diagnostic-only', () => {
    const evaluations: CandidateEvaluation[] = [];
    const events = runSyntheticScenario({
      evaluationSink: evaluations,
      frame: (time) => negativeScenarioFrame(NegativeKind.POTHOLE, time, 1.2)
    });
    expect(events).toEqual([]);
    expect(evaluations.length).toBeGreaterThan(0);
    expect(evaluations.at(-1)?.explanation).toContain('pothole shape');
    expect(evaluations.at(-1)?.explanation).toContain('Final confidence');
    expect(evaluations.at(-1)?.explanation).toContain('REJECTED');
  });

  it('never arms from a stationary bump-shaped waveform', () => {
    const detector = new HeuristicRoadEventDetector();
    let detected = false;
    for (let index = 0; index < 800; index += 1) {
      const time = index / 100;
      const vertical = normalBump(time, 3.2);
      const event = detector.addSample(
        createMotionSample({
          elapsedRealtimeNanos: 30_000_000_000 + index * 10_000_000,
          epochMillis: index * 10,
          accelerationX: 0,
          accelerationY: 0,
          accelerationZ: 9.80665 + vertical,
          verticalAcceleration: vertical
        }),
        0,
        LocationQuality.GOOD,
        1
      );
      detected ||= event !== null;
    }
    expect(detected).toBe(false);
  });

  it('labels accepted events only as possible or likely speed bumps', () => {
    const events = runSyntheticScenario({
      frame: (time) => ({ vertical: normalBump(time, 3.2) })
    });
    expect(events).toHaveLength(1);
    expect([
      RoadEventType.POSSIBLE_SPEED_BUMP,
      RoadEventType.LIKELY_SPEED_BUMP
    ]).toContain(events[0].eventType);
    const contributionTotal = events[0].scoreContributions.reduce(
      (total, contribution) => total + contribution.value,
      0
    );
    expect(events[0].confidence).toBeCloseTo(
      Math.min(1, Math.max(0, contributionTotal)),
      12
    );
    expect(events[0].scoreContributions.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'vertical waveform',
        'event isolation',
        'adaptive SNR',
        'rough-road continuity',
        'pothole shape',
        'phone movement'
      ])
    );
  });

  it('drops duplicate and backward timestamps before diagnostics or history', () => {
    const detector = new HeuristicRoadEventDetector();
    let frameCount = 0;
    detector.setDiagnosticsListener({ onFrame: () => (frameCount += 1) });
    const first = createMotionSample({
      elapsedRealtimeNanos: 1_000_000_000,
      epochMillis: 1_000,
      accelerationX: 0,
      accelerationY: 0,
      accelerationZ: 9.80665,
      verticalAcceleration: 0
    });
    detector.addSample(first, 7, LocationQuality.GOOD, 1);
    detector.addSample(first, 7, LocationQuality.GOOD, 1);
    detector.addSample({ ...first, elapsedRealtimeNanos: 999_000_000 }, 7, LocationQuality.GOOD, 1);
    expect(frameCount).toBe(1);
    expect(detector.historySize).toBe(1);
  });
});

describe('release scenario catalog', () => {
  it('maps every requested real-bump and false-positive name', () => {
    const expectedNames = [
      'normal speed bump',
      'small bump',
      'sharp bump',
      'large bump',
      'wide hump',
      'raised table',
      'low-speed crossing',
      'moderate-speed crossing',
      'no braking',
      'heavy braking',
      'bump on rough road',
      'consecutive bumps',
      'asymmetric bump',
      'pothole',
      'multiple potholes',
      'rough asphalt',
      'short rough patch',
      'sustained rough road',
      'cracks',
      'bridge joint',
      'expansion joint',
      'manhole cover',
      'gravel',
      'cobblestone',
      'hard braking',
      'acceleration',
      'brake then accelerate',
      'turn',
      'roundabout',
      'lane change',
      'hill',
      'ramp',
      'phone movement',
      'phone being picked up',
      'device rotation',
      'repeated vibration'
    ];
    expect(USER_SCENARIO_CATALOG.map((scenario) => scenario.name).sort()).toEqual(
      [...expectedNames].sort()
    );
    expect(USER_SCENARIO_CATALOG.every((scenario) => scenario.variant.length > 0)).toBe(true);
  });
});
