import { CarFront, ChevronDown, Route } from 'lucide-react';
import type { DriveSession } from '../core/models';
import { EmptyState, Screen, StatusLine, TopBar } from './Common';
import { formatDateTime, formatDistance, formatDriveDuration, formatSpeed } from './formatters';

export interface DrivesScreenProps {
  drives: DriveSession[];
  metricUnits: boolean;
}
export function DrivesScreen({ drives, metricUnits }: DrivesScreenProps) {
  return (
    <>
      <TopBar title="Drive history" />
      <Screen className="bc-drives-screen">
        {drives.length === 0 ? (
          <EmptyState
            title="No drive history yet"
            body="Your bump and drive data stays on this device unless you export it."
            icon={Route}
          />
        ) : (
          <div className="bc-drive-list">
            {drives.map((drive) => <DriveCard key={drive.id} drive={drive} metricUnits={metricUnits} />)}
          </div>
        )}
      </Screen>
    </>
  );
}

function DriveCard({ drive, metricUnits }: { drive: DriveSession; metricUnits: boolean }) {
  return (
    <details className="bc-drive-card">
      <summary>
        <CarFront aria-hidden="true" size={24} />
        <span className="bc-drive-card__summary">
          <strong>{formatDateTime(drive.startedAt)}</strong>
          <span>{formatDriveDuration(drive.durationMillis)} • {formatDistance(drive.distanceMetres, metricUnits)}</span>
        </span>
        <ChevronDown className="bc-drive-card__chevron" aria-hidden="true" size={22} />
        <span className="bc-info-pill">{drive.candidateCount} bumps found</span>
        <span className="bc-info-pill">{drive.warningCount} warnings</span>
      </summary>
      <div className="bc-drive-card__details">
        <hr className="bc-divider" />
        <StatusLine label="Maximum speed" value={formatSpeed(drive.maximumSpeedMetresPerSecond, metricUnits)} />
        <StatusLine label="Average speed" value={formatSpeed(drive.averageSpeedMetresPerSecond, metricUnits)} />
        <StatusLine label="Known bumps passed" value={String(drive.knownBumpPasses)} />
        {drive.incomplete ? <p className="bc-drive-incomplete">Drive ended unexpectedly</p> : null}
      </div>
    </details>
  );
}
