import {
  CarFront,
  CircleStop,
  ClipboardCheck,
  LockKeyhole,
  MapPinPlus,
  Navigation,
  Pause,
  Play,
  Smartphone,
  Volume2,
  VolumeX
} from 'lucide-react';
import {
  DriveServiceState,
  PhonePlacementState,
  type DriveRuntimeState,
  type DriveSession
} from '../core/models';
import {
  Button,
  Dialog,
  InlineNotice,
  MetricBlock,
  Screen,
  SectionTitle,
  StatusLine,
  TopBar
} from './Common';
import { formatClockDuration, formatDistance, formatSpeed } from './formatters';
import { isDriveActive } from './utils';

export interface HomeScreenProps {
  runtime: DriveRuntimeState;
  confirmedBumps: number;
  pendingCandidates: number;
  latestDrive: DriveSession | null;
  metricUnits: boolean;
  detectionSupported: boolean;
  locationEnabled: boolean;
  startDialogOpen: boolean;
  startBusy?: boolean;
  startError?: string | null;
  now?: number;
  onOpenStartDialog: () => void;
  onCloseStartDialog: () => void;
  onStartDrive: () => void;
  onPause: () => void;
  onResume: () => void;
  onEndDrive: () => void;
  onMarkBump: () => void;
  onToggleMute: () => void;
  onOpenNavigation: () => void;
  onReviewCandidates: () => void;
}

export function HomeScreen(props: HomeScreenProps) {
  const active = isDriveActive(props.runtime);
  return (
    <>
      <TopBar title="BumpCompanion" />
      {active ? <ActiveDrive {...props} /> : <IdleHome {...props} />}
      <StartDriveDialog
        open={props.startDialogOpen}
        busy={props.startBusy}
        error={props.startError}
        onDismiss={props.onCloseStartDialog}
        onStart={props.onStartDrive}
      />
    </>
  );
}

function IdleHome({
  runtime,
  confirmedBumps,
  pendingCandidates,
  latestDrive,
  metricUnits,
  detectionSupported,
  locationEnabled,
  onOpenStartDialog,
  onOpenNavigation,
  onReviewCandidates
}: HomeScreenProps) {
  const ready = detectionSupported && locationEnabled;
  const readinessLabel = !detectionSupported
    ? 'Detection unavailable'
    : !locationEnabled
      ? 'Location off'
      : 'Ready';

  return (
    <Screen className="bc-home bc-home--idle">
      <div className="bc-content-column">
        {runtime.errorMessage ? <InlineNotice tone="error">{runtime.errorMessage}</InlineNotice> : null}
        <div className="bc-status-group">
          <StatusLine label="Bump detection" value={readinessLabel} positive={ready} />
          <StatusLine label="Phone placement" value="Secure mount recommended" />
        </div>

        <Button
          className="bc-start-drive"
          fullWidth
          icon={CarFront}
          disabled={!detectionSupported}
          onClick={onOpenStartDialog}
        >
          Start Drive
        </Button>

        <div className="bc-two-column-actions">
          <Button tone="outline" icon={Navigation} onClick={onOpenNavigation}>Open navigation</Button>
          <Button
            tone="outline"
            icon={ClipboardCheck}
            disabled={pendingCandidates === 0}
            onClick={onReviewCandidates}
          >
            Review bumps
          </Button>
        </div>

        <hr className="bc-divider" />

        <div className="bc-metric-grid">
          <MetricBlock label="Saved bumps" value={String(confirmedBumps)} />
          <MetricBlock label="Needs review" value={String(pendingCandidates)} />
        </div>

        <div className="bc-home-section">
          <SectionTitle>Last drive</SectionTitle>
          {latestDrive ? (
            <p className="bc-summary-line">
              {formatClockDuration(latestDrive.durationMillis)}
              <span aria-hidden="true"> • </span>
              {formatDistance(latestDrive.distanceMetres, metricUnits)}
              <span aria-hidden="true"> • </span>
              {latestDrive.candidateCount} bumps found
            </p>
          ) : <p className="bc-muted">No drives yet</p>}
        </div>

        <div className="bc-privacy-card">
          <LockKeyhole aria-hidden="true" size={22} />
          <p>Your bump and drive data stays on this device unless you export it.</p>
        </div>

        <SafetyStatement />
      </div>
    </Screen>
  );
}

function ActiveDrive({
  runtime,
  metricUnits,
  now = Date.now(),
  onPause,
  onResume,
  onEndDrive,
  onMarkBump,
  onToggleMute,
  onOpenNavigation
}: HomeScreenProps) {
  const paused = runtime.serviceState === DriveServiceState.PAUSED ||
    runtime.serviceState === DriveServiceState.BACKGROUND_PAUSED;
  const preparing = runtime.serviceState === DriveServiceState.PREPARING;
  const elapsed = runtime.startedAt === null ? 0 : Math.max(0, now - runtime.startedAt);

  return (
    <Screen className="bc-home bc-home--active">
      <div className="bc-content-column bc-active-drive">
        <p className="bc-drive-state" role="status">
          {preparing ? 'Starting Drive Mode…' : paused ? 'Drive paused' : 'Drive active'}
        </p>

        {runtime.serviceState === DriveServiceState.BACKGROUND_PAUSED || runtime.foregroundRequired ? (
          <InlineNotice tone="warning" title="Keep BumpCompanion open">
            Detection pauses when this app is hidden or the iPhone is locked. Return here before continuing your drive.
          </InlineNotice>
        ) : null}

        {runtime.errorMessage ? <InlineNotice tone="error">{runtime.errorMessage}</InlineNotice> : null}

        <div className="bc-speed-readout" aria-live="polite">
          <MetricBlock
            label="Current speed"
            value={formatSpeed(runtime.currentSpeedMetresPerSecond, metricUnits)}
            prominent
          />
        </div>

        <div className="bc-metric-grid">
          <MetricBlock label="Duration" value={formatClockDuration(elapsed)} />
          <MetricBlock label="Distance" value={formatDistance(runtime.distanceMetres, metricUnits)} />
        </div>

        <hr className="bc-divider" />

        <div className="bc-status-group">
          {runtime.phonePlacementState === PhonePlacementState.UNSTABLE ? (
            <StatusLine label="Phone placement" value="Secure the phone in its mount" positive={false} />
          ) : null}
          <StatusLine label="Known bumps passed" value={String(runtime.knownBumpsPassed)} />
          <StatusLine
            label="Next probable bump"
            value={runtime.nextBumpDistanceMetres === null
              ? 'None nearby'
              : formatDistance(runtime.nextBumpDistanceMetres, metricUnits, true)}
          />
        </div>

        <div className="bc-drive-controls">
          <div className="bc-two-column-actions">
            <Button
              icon={paused ? Play : Pause}
              disabled={preparing}
              onClick={paused ? onResume : onPause}
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button tone="tonal" icon={CircleStop} onClick={onEndDrive}>End Drive</Button>
          </div>
          <div className="bc-two-column-actions">
            <Button tone="outline" icon={MapPinPlus} disabled={preparing} onClick={onMarkBump}>Mark bump</Button>
            <Button
              tone="outline"
              icon={runtime.warningsMuted ? Volume2 : VolumeX}
              onClick={onToggleMute}
            >
              {runtime.warningsMuted ? 'Unmute' : 'Mute'}
            </Button>
          </div>
          <Button fullWidth tone="outline" icon={Navigation} onClick={onOpenNavigation}>Open navigation</Button>
        </div>

        <SafetyStatement />
      </div>
    </Screen>
  );
}

export interface StartDriveDialogProps {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onDismiss: () => void;
  onStart: () => void;
}

export function StartDriveDialog({ open, busy = false, error, onDismiss, onStart }: StartDriveDialogProps) {
  return (
    <Dialog
      open={open}
      title="Ready to drive?"
      icon={Smartphone}
      variant="sheet"
      onDismiss={busy ? () => undefined : onDismiss}
      actions={(
        <>
          <Button tone="ghost" disabled={busy} onClick={onDismiss}>Cancel</Button>
          <Button disabled={busy} onClick={onStart}>{busy ? 'Starting…' : 'Phone is mounted'}</Button>
        </>
      )}
    >
      <p>Secure the phone in a stable mount. Do not interact with the app while driving.</p>
      <InlineNotice tone="info">
        Keep BumpCompanion visible during the drive. Your browser will ask for motion and precise location access when needed.
      </InlineNotice>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </Dialog>
  );
}

function SafetyStatement() {
  return (
    <p className="bc-safety-statement">
      BumpCompanion may miss bumps or give incorrect warnings. Always watch the road and drive safely.
    </p>
  );
}
