import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  BumpStatus,
  CandidateDecision,
  DEFAULT_SETTINGS,
  DriveServiceState,
  EMPTY_RUNTIME,
  RoadEventType,
  Sensitivity,
  createSpeedBump,
  type CandidateEvent
} from '../../src/core/models';
import { BumpsScreen, EditBumpDialog } from '../../src/ui/Bumps';
import { HomeScreen } from '../../src/ui/Home';
import { InstallHelp } from '../../src/ui/InstallHelp';
import { Onboarding } from '../../src/ui/Onboarding';
import { ReviewScreen } from '../../src/ui/Review';
import { SettingsScreen } from '../../src/ui/Settings';

describe('Onboarding', () => {
  it('advances, goes back, skips, and completes through controlled callbacks', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const onComplete = vi.fn();
    const onSkip = vi.fn();
    const view = render(
      <Onboarding pageIndex={0} onPageChange={onPageChange} onComplete={onComplete} onSkip={onSkip} />
    );

    expect(screen.getByText('Runs while visible')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalledOnce();

    view.rerender(
      <Onboarding pageIndex={3} onPageChange={onPageChange} onComplete={onComplete} onSkip={onSkip} />
    );
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole('button', { name: 'Get started' }));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});

describe('Home screen', () => {
  it('shows readiness and the controlled start flow without exposing diagnostics', async () => {
    const user = userEvent.setup();
    const callbacks = homeCallbacks();
    const view = render(
      <HomeScreen
        {...callbacks}
        runtime={{ ...EMPTY_RUNTIME, errorMessage: 'Motion access was denied.' }}
        confirmedBumps={4}
        pendingCandidates={2}
        latestDrive={null}
        metricUnits
        detectionSupported
        locationEnabled
        startDialogOpen={false}
      />
    );

    expect(screen.getByText('Ready')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Motion access was denied.');
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Start Drive/i }));
    expect(callbacks.onOpenStartDialog).toHaveBeenCalledOnce();

    view.rerender(
      <HomeScreen
        {...callbacks}
        runtime={EMPTY_RUNTIME}
        confirmedBumps={4}
        pendingCandidates={2}
        latestDrive={null}
        metricUnits
        detectionSupported
        locationEnabled
        startDialogOpen
      />
    );
    expect(screen.getByRole('dialog', { name: 'Ready to drive?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Phone is mounted' }));
    expect(callbacks.onStartDrive).toHaveBeenCalledOnce();
  });

  it('renders active paused controls from runtime state', async () => {
    const user = userEvent.setup();
    const callbacks = homeCallbacks();
    render(
      <HomeScreen
        {...callbacks}
        runtime={{
          ...EMPTY_RUNTIME,
          serviceState: DriveServiceState.PAUSED,
          startedAt: 1_000,
          currentSpeedMetresPerSecond: 10,
          distanceMetres: 1_250,
          knownBumpsPassed: 3
        }}
        confirmedBumps={0}
        pendingCandidates={0}
        latestDrive={null}
        metricUnits
        detectionSupported
        locationEnabled
        startDialogOpen={false}
        now={3_661_000}
      />
    );

    expect(screen.getByText('Drive paused')).toBeVisible();
    expect(screen.getByText('36 km/h')).toBeVisible();
    expect(screen.getByText('01:01:00')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(callbacks.onResume).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'End Drive' }));
    expect(callbacks.onEndDrive).toHaveBeenCalledOnce();
  });
});

describe('Bump management', () => {
  it('keeps filtering, search, view, and selection controlled', async () => {
    const user = userEvent.setup();
    const bump = createSpeedBump({
      id: 'bump-1',
      latitude: 24.7136,
      longitude: 46.6753,
      roadName: 'King Road'
    });
    const onSearchChange = vi.fn();
    const onFilterChange = vi.fn();
    const onViewChange = vi.fn();
    const onSelectBump = vi.fn();
    render(
      <BumpsScreen
        items={[bump]}
        filter={BumpStatus.CONFIRMED}
        search=""
        view="list"
        selectedBump={null}
        onSearchChange={onSearchChange}
        onFilterChange={onFilterChange}
        onViewChange={onViewChange}
        onSelectBump={onSelectBump}
        onSaveBump={vi.fn()}
        onToggleWarning={vi.fn()}
        onArchive={vi.fn()}
        onMarkRemoved={vi.fn()}
        onDelete={vi.fn()}
        onOpenExternal={vi.fn()}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search bumps' }), 'King');
    expect(onSearchChange).toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'Pending' }));
    expect(onFilterChange).toHaveBeenCalledWith(BumpStatus.PENDING);
    await user.click(screen.getByRole('button', { name: 'Map' }));
    expect(onViewChange).toHaveBeenCalledWith('map');
    await user.click(screen.getByRole('button', { name: /King Road/ }));
    expect(onSelectBump).toHaveBeenCalledWith(bump);
  });

  it('validates coordinates before saving edits', async () => {
    const user = userEvent.setup();
    const bump = createSpeedBump({ id: 'bump-2', latitude: 10, longitude: 20 });
    const onSave = vi.fn();
    render(<EditBumpDialog bump={bump} onDismiss={vi.fn()} onSave={onSave} />);

    const latitude = screen.getByRole('textbox', { name: 'Latitude' });
    await user.clear(latitude);
    await user.type(latitude, '100');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter valid latitude');
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(latitude);
    await user.type(latitude, '24.71');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ latitude: 24.71, longitude: 20 }));
  });
});

describe('Review and settings', () => {
  it('allows review decisions but keeps detector confidence out of view', async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    const onConfirmProbable = vi.fn();
    render(
      <ReviewScreen
        candidates={[candidate()]}
        metricUnits
        onBack={vi.fn()}
        onDecision={onDecision}
        onConfirmProbable={onConfirmProbable}
      />
    );

    expect(screen.queryByText('0.82')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm likely bumps' }));
    expect(onConfirmProbable).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Mark as pothole' }));
    expect(onDecision).toHaveBeenCalledWith('candidate-1', CandidateDecision.POTHOLE);
  });

  it('disables warning children with the master setting and confirms destructive deletion', async () => {
    const user = userEvent.setup();
    const onWarningsChange = vi.fn();
    const onConfirmDeleteAll = vi.fn();
    const common = settingsCallbacks();
    render(
      <SettingsScreen
        {...common}
        settings={{ ...DEFAULT_SETTINGS, warningsEnabled: false, sensitivity: Sensitivity.BALANCED }}
        deleteAllDialogOpen
        onWarningsChange={onWarningsChange}
        onConfirmDeleteAll={onConfirmDeleteAll}
      />
    );

    expect(screen.getByRole('switch', { name: 'Voice' })).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Enable warnings' }));
    expect(onWarningsChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(onConfirmDeleteAll).toHaveBeenCalledOnce();
  });

  it('provides the complete Safari Add to Home Screen instructions', () => {
    render(<InstallHelp open onDismiss={vi.fn()} />);
    expect(screen.getByText(/Open this website in/)).toHaveTextContent('Safari');
    expect(screen.getByText(/Add to Home Screen/)).toBeVisible();
    expect(screen.getByText(/iOS pauses browser sensor access in the background/)).toBeVisible();
  });
});

function homeCallbacks() {
  return {
    onOpenStartDialog: vi.fn(),
    onCloseStartDialog: vi.fn(),
    onStartDrive: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onEndDrive: vi.fn(),
    onMarkBump: vi.fn(),
    onToggleMute: vi.fn(),
    onOpenNavigation: vi.fn(),
    onReviewCandidates: vi.fn()
  };
}

function settingsCallbacks() {
  return {
    onSensitivityChange: vi.fn(),
    onWarningsChange: vi.fn(),
    onVoiceChange: vi.fn(),
    onToneChange: vi.fn(),
    onVibrationChange: vi.fn(),
    onAdaptiveDistanceChange: vi.fn(),
    onRouteHistoryChange: vi.fn(),
    onMetricUnitsChange: vi.fn(),
    onThemeChange: vi.fn(),
    onDynamicColourChange: vi.fn(),
    onOpenCalibration: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onDeleteHistory: vi.fn(),
    onRequestDeleteAll: vi.fn(),
    onCancelDeleteAll: vi.fn(),
    onConfirmDeleteAll: vi.fn(),
    onConfirmImport: vi.fn(),
    onCancelImport: vi.fn()
  };
}

function candidate(): CandidateEvent {
  return {
    id: 'candidate-1',
    driveId: 'drive-1',
    detectedAt: 1_700_000_000_000,
    eventElapsedRealtimeNanos: 1,
    latitude: 24.7136,
    longitude: 46.6753,
    horizontalAccuracyMetres: 5,
    coordinateConfidence: 0.9,
    speedMetresPerSecond: 10,
    bearingDegrees: 120,
    confidence: 0.82,
    eventType: RoadEventType.LIKELY_SPEED_BUMP,
    decision: CandidateDecision.PENDING,
    confidenceReasons: [],
    positiveVerticalPeak: 1,
    negativeVerticalPeak: -1,
    peakToPeak: 2,
    peakGapMillis: 200,
    verticalRms: 1,
    jerkPeak: 1,
    gyroscopeEnergy: 0,
    orientationVariance: 0,
    phoneStability: 1,
    source: 'DETECTED' as CandidateEvent['source'],
    note: ''
  };
}
