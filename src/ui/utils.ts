import { DriveServiceState, type DriveRuntimeState } from '../core/models';

const ACTIVE_DRIVE_STATES = new Set<DriveServiceState>([
  DriveServiceState.PREPARING,
  DriveServiceState.ACTIVE,
  DriveServiceState.PAUSED,
  DriveServiceState.BACKGROUND_PAUSED,
  DriveServiceState.GPS_DEGRADED,
  DriveServiceState.SENSOR_DEGRADED
]);

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
export function isDriveActive(runtime: DriveRuntimeState): boolean {
  return ACTIVE_DRIVE_STATES.has(runtime.serviceState);
}
