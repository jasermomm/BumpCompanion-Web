import { describe, expect, it } from 'vitest';
import { LocationQuality } from '../../src/core/detector';
import {
  DETECTOR_CSV_HEADER,
  detectorCsvSampleLine,
  parseCsvLine,
  replayDetectorCsv,
  replayDetectorCsvTimed
} from '../../src/testing/detectorReplay';
import { normalBump } from '../../src/testing/detectorScenarios';

describe('detector CSV replay', () => {
  it('parses escaped fields without corrupting commas or quotes', () => {
    expect(parseCsvLine('a,"b,c","d""e"')).toEqual(['a', 'b,c', 'd"e']);
  });

  it('replays timestamped samples through the exact production core', () => {
    const lines = ['# mode=full', DETECTOR_CSV_HEADER.join(',')];
    for (let index = 0; index < 800; index += 1) {
      const time = index / 100;
      const vertical = normalBump(time, 3.2);
      lines.push(
        detectorCsvSampleLine({
          elapsed_nanos: 40_000_000_000 + index * 10_000_000,
          epoch_millis: index * 10,
          ax: 0.03,
          ay: -0.35,
          az: 9.80665 + vertical,
          gyro_x: 0.00875,
          gyro_y: 0.01125,
          gyro_z: 0.025,
          vertical,
          longitudinal: time >= 2 && time <= 3.8 ? -0.35 : 0,
          lateral: 0.04,
          orientation_change: 0.002,
          orientation_reliable: true,
          speed: 7,
          speed_accuracy: 0.4,
          location_quality: LocationQuality.GOOD,
          phone_stability: 0.96
        })
      );
    }
    const result = replayDetectorCsv(lines.join('\n'));
    expect(result.samplesRead).toBe(800);
    expect(result.malformedRows).toBe(0);
    expect(result.events).toHaveLength(1);
  });

  it('counts malformed samples while retaining valid preceding rows', () => {
    const valid = detectorCsvSampleLine({
      elapsed_nanos: 1_000_000_000,
      epoch_millis: 0,
      vertical: 0,
      location_quality: LocationQuality.GOOD,
      speed: 7
    });
    const invalid = detectorCsvSampleLine({
      elapsed_nanos: 'not-a-timestamp',
      record_type: 'sample'
    });
    const result = replayDetectorCsv([DETECTOR_CSV_HEADER.join(','), valid, invalid].join('\n'));
    expect(result.samplesRead).toBe(1);
    expect(result.malformedRows).toBe(1);
  });

  it('supports real-time and accelerated timing with an injectable wait', async () => {
    const lines = [DETECTOR_CSV_HEADER.join(',')];
    for (let index = 0; index < 3; index += 1) {
      lines.push(
        detectorCsvSampleLine({
          elapsed_nanos: 2_000_000_000 + index * 10_000_000,
          epoch_millis: index * 10,
          vertical: 0,
          location_quality: LocationQuality.GOOD,
          speed: 7
        })
      );
    }
    const waits: number[] = [];
    const result = await replayDetectorCsvTimed(lines.join('\n'), {
      speedMultiplier: 4,
      wait: (delay) => {
        waits.push(delay);
        return Promise.resolve();
      }
    });
    expect(result.samplesRead).toBe(3);
    expect(waits).toEqual([2.5, 2.5]);
  });

  it('rejects invalid replay speed multipliers', async () => {
    await expect(replayDetectorCsvTimed(DETECTOR_CSV_HEADER.join(','), { speedMultiplier: 0 })).rejects.toThrow(
      RangeError
    );
  });
});
