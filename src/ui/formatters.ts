import { RoadEventType } from '../core/models';

const METRES_PER_MILE = 1_609.344;
const FEET_PER_METRE = 3.2808399;

export function formatClockDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}
export function formatDriveDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatSpeed(metresPerSecond: number | null, metric: boolean): string {
  if (metresPerSecond === null || !Number.isFinite(metresPerSecond)) return '—';
  const converted = metresPerSecond * (metric ? 3.6 : 2.2369363);
  return `${Math.round(Math.max(0, converted))} ${metric ? 'km/h' : 'mph'}`;
}

export function formatDistance(metres: number, metric: boolean, compact = false): string {
  const safeMetres = Number.isFinite(metres) ? Math.max(0, metres) : 0;
  if (metric) {
    if (safeMetres < 1_000 || compact) return `${Math.round(safeMetres)} m`;
    return `${(safeMetres / 1_000).toFixed(1)} km`;
  }

  const feet = safeMetres * FEET_PER_METRE;
  if (safeMetres < METRES_PER_MILE || compact) return `${Math.round(feet)} ft`;
  return `${(safeMetres / METRES_PER_MILE).toFixed(1)} mi`;
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export function formatDateTime(timestamp: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}

export function formatSeenCount(count: number): string {
  return count === 1 ? 'Seen once' : `Seen ${count} times`;
}

export function roadEventLabel(type: RoadEventType): string {
  switch (type) {
    case RoadEventType.LIKELY_SPEED_BUMP:
      return 'Likely speed bump';
    case RoadEventType.POSSIBLE_SPEED_BUMP:
      return 'Possible speed bump';
    case RoadEventType.POTHOLE_LIKE:
      return 'Possible pothole';
    case RoadEventType.ROUGH_ROAD:
      return 'Rough road';
    case RoadEventType.PHONE_MOVEMENT:
      return 'Phone movement';
    case RoadEventType.HARD_BRAKING:
      return 'Hard braking';
    case RoadEventType.DISCARDED:
      return 'Discarded';
    case RoadEventType.UNKNOWN:
    default:
      return 'Unknown event';
  }
}
