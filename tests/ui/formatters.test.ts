import { describe, expect, it } from 'vitest';
import { RoadEventType } from '../../src/core/models';
import {
  formatClockDuration,
  formatCoordinates,
  formatDistance,
  formatDriveDuration,
  formatSeenCount,
  formatSpeed,
  roadEventLabel
} from '../../src/ui/formatters';

describe('production formatters', () => {
  it('formats active and historical drive durations like the Android app', () => {
    expect(formatClockDuration(3_661_000)).toBe('01:01:01');
    expect(formatClockDuration(-10)).toBe('00:00:00');
    expect(formatDriveDuration(3_661_000)).toBe('1h 1m');
    expect(formatDriveDuration(59_000)).toBe('0m');
  });

  it('formats metric and imperial speed and distance', () => {
    expect(formatSpeed(10, true)).toBe('36 km/h');
    expect(formatSpeed(10, false)).toBe('22 mph');
    expect(formatSpeed(null, true)).toBe('—');
    expect(formatDistance(850, true)).toBe('850 m');
    expect(formatDistance(1_250, true)).toBe('1.3 km');
    expect(formatDistance(1_609.344, false)).toBe('1.0 mi');
  });

  it('keeps consumer-facing labels and coordinates stable', () => {
    expect(formatCoordinates(24.713551, 46.675296)).toBe('24.71355, 46.67530');
    expect(formatSeenCount(1)).toBe('Seen once');
    expect(formatSeenCount(3)).toBe('Seen 3 times');
    expect(roadEventLabel(RoadEventType.POTHOLE_LIKE)).toBe('Possible pothole');
  });
});
