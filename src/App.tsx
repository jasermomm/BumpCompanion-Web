import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react';
import {
  BumpStatus,
  CandidateDecision,
  DEFAULT_SETTINGS,
  ThemeMode,
  type AppSettings,
  type CalibrationProfile,
  type CandidateEvent,
  type DriveSession,
  type SpeedBump
} from './core/models';
import {
  BumpExchangeManager,
  BumpRepository,
  CalibrationRepository,
  DriveRepository,
  SettingsRepository,
  clearAllLocalData,
  getDatabase,
  type ImportPreview
} from './data';
import { BrowserCalibrationService } from './platform/calibration';
import { DriveController } from './runtime/driveController';
import {
  AppShell,
  BumpsScreen,
  CalibrationScreen,
  DrivesScreen,
  HomeScreen,
  InstallHelp,
  LoadingOverlay,
  Onboarding,
  ReviewScreen,
  SettingsScreen,
  Toast,
  isDriveActive,
  type AppTab,
  type BumpsView
} from './ui';

type DetailScreen = 'review' | 'calibration' | null;

const settingsRepository = new SettingsRepository();
const bumpRepository = new BumpRepository();
const driveRepository = new DriveRepository();
const calibrationRepository = new CalibrationRepository();
const exchangeManager = new BumpExchangeManager();

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Something went wrong. Please try again.';
}

function useClock(enabled: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const controllerRef = useRef<DriveController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new DriveController(DEFAULT_SETTINGS, {
      bumps: bumpRepository,
      drives: driveRepository
    });
  }
  const controller = controllerRef.current;
  const runtime = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );

  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [tab, setTab] = useState<AppTab>('home');
  const [detail, setDetail] = useState<DetailScreen>(null);
  const [onboardingPage, setOnboardingPage] = useState(0);
  const [bumps, setBumps] = useState<SpeedBump[]>([]);
  const [candidates, setCandidates] = useState<CandidateEvent[]>([]);
  const [drives, setDrives] = useState<DriveSession[]>([]);
  const [calibration, setCalibration] = useState<CalibrationProfile | null>(null);
  const [bumpFilter, setBumpFilter] = useState<BumpStatus | null>(BumpStatus.CONFIRMED);
  const [bumpSearch, setBumpSearch] = useState('');
  const [bumpView, setBumpView] = useState<BumpsView>('list');
  const [selectedBump, setSelectedBump] = useState<SpeedBump | null>(null);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<ImportPreview | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [calibrationRunning, setCalibrationRunning] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [locationEnabled, setLocationEnabled] = useState('geolocation' in navigator);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshCollections = useCallback(async () => {
    const [nextBumps, nextCandidates, nextDrives, nextCalibration] = await Promise.all([
      bumpRepository.listBumps(),
      bumpRepository.listPendingCandidates(),
      driveRepository.listDrives(),
      calibrationRepository.latest()
    ]);
    setBumps(nextBumps);
    setCandidates(nextCandidates);
    setDrives(nextDrives);
    setCalibration(nextCalibration);
  }, []);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        await driveRepository.recoverIncompleteDrives();
        const savedSettings = await settingsRepository.get();
        if (!current) return;
        setSettings(savedSettings);
        controller.updateSettings(savedSettings);
        await refreshCollections();
        if (current) setReady(true);
      } catch (error) {
        if (current) setFatalError(errorMessage(error));
      }
    })();
    return () => {
      current = false;
      void controller.dispose();
    };
  }, [controller, refreshCollections]);

  useEffect(() => {
    const mode = settings.themeMode.toLowerCase();
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeMeta) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      themeMeta.content = mode === 'dark' || (mode === 'system' && prefersDark)
        ? '#121316'
        : '#8A5A00';
    }
  }, [settings.reducedMotion, settings.themeMode]);

  useEffect(() => {
    if (!('permissions' in navigator)) return undefined;
    let permission: PermissionStatus | null = null;
    let active = true;
    const update = () => {
      if (active && permission) setLocationEnabled(permission.state !== 'denied');
    };
    void navigator.permissions.query({ name: 'geolocation' }).then((result) => {
      if (!active) return;
      permission = result;
      update();
      result.addEventListener('change', update);
    }).catch(() => {
      // Safari versions without Permissions API support still request location on Start Drive.
    });
    return () => {
      active = false;
      permission?.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    if (ready) void refreshCollections();
  }, [ready, refreshCollections, runtime.candidateCount, runtime.driveId]);

  const activeDrive = isDriveActive(runtime);
  const now = useClock(activeDrive);
  const visibleBumps = useMemo(() => {
    const query = bumpSearch.trim().toLocaleLowerCase();
    return bumps.filter((bump) => {
      if (bumpFilter !== null && bump.status !== bumpFilter) return false;
      if (!query) return true;
      return [
        bump.roadName,
        bump.regionLabel,
        bump.importedSource,
        bump.notes,
        `${bump.latitude.toFixed(5)}, ${bump.longitude.toFixed(5)}`
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [bumpFilter, bumpSearch, bumps]);

  const latestDrive = drives[0] ?? null;
  const confirmedBumps = bumps.filter((bump) =>
    (bump.status === BumpStatus.CONFIRMED || bump.status === BumpStatus.IMPORTED) &&
    !bump.archived && !bump.markedRemoved).length;

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    try {
      const saved = await settingsRepository.update(patch);
      setSettings(saved);
      controller.updateSettings(saved);
    } catch (error) {
      setToast(errorMessage(error));
    }
  }, [controller]);

  const completeOnboarding = () => {
    void saveSettings({ onboardingComplete: true });
  };

  const changeTab = (nextTab: AppTab) => {
    setDetail(null);
    setTab(nextTab);
  };

  const startDrive = async () => {
    setStartBusy(true);
    setStartError(null);
    try {
      await controller.start();
      setStartDialogOpen(false);
      setTab('home');
      await refreshCollections();
    } catch (error) {
      setStartError(errorMessage(error));
    } finally {
      setStartBusy(false);
    }
  };

  const runDriveAction = (action: () => Promise<void>) => {
    void action().then(refreshCollections).catch((error: unknown) => setToast(errorMessage(error)));
  };

  const decideCandidate = async (candidateId: string, decision: CandidateDecision) => {
    try {
      const bump = await bumpRepository.decideCandidate(candidateId, decision);
      setToast(bump ? 'Speed bump saved.' : 'Detection reviewed.');
      await refreshCollections();
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const confirmProbable = async () => {
    setOperationBusy(true);
    try {
      let confirmed = 0;
      for (const candidate of candidates) {
        if (candidate.confidence >= 0.7 && candidate.latitude !== null && candidate.longitude !== null) {
          if (await bumpRepository.confirmCandidate(candidate.id)) confirmed += 1;
        }
      }
      setToast(confirmed === 1 ? '1 likely bump confirmed.' : `${confirmed} likely bumps confirmed.`);
      await refreshCollections();
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setOperationBusy(false);
    }
  };

  const updateBump = async (bump: SpeedBump) => {
    try {
      await bumpRepository.updateBump(bump);
      setSelectedBump(null);
      setToast('Bump updated.');
      await refreshCollections();
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  const mutateBump = (operation: () => Promise<void>, message: string) => {
    void operation().then(async () => {
      setSelectedBump(null);
      setToast(message);
      await refreshCollections();
    }).catch((error: unknown) => setToast(errorMessage(error)));
  };

  const openExternalCoordinate = (bump: SpeedBump) => {
    const label = encodeURIComponent(bump.roadName ?? bump.regionLabel ?? 'Speed bump');
    const coordinate = `${bump.latitude},${bump.longitude}`;
    window.open(`https://maps.apple.com/?ll=${coordinate}&q=${label}`, '_blank', 'noopener,noreferrer');
  };

  const openNavigation = () => {
    window.open('https://maps.apple.com/', '_blank', 'noopener,noreferrer');
  };

  const exportBumps = async () => {
    setOperationBusy(true);
    try {
      const artifact = await exchangeManager.createExport('BumpCompanion bumps', 'BumpCompanion Web');
      const date = new Date().toISOString().slice(0, 10);
      const file = new File([artifact.blob], `BumpCompanion-${date}.bumpcompanion`, {
        type: 'application/json'
      });
      const canShare = typeof navigator.share === 'function' &&
        (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
      if (canShare) {
        await navigator.share({ title: 'BumpCompanion bump list', files: [file] });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setToast(artifact.count === 1 ? '1 bump exported.' : `${artifact.count} bumps exported.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setToast(errorMessage(error));
      }
    } finally {
      setOperationBusy(false);
    }
  };

  const chooseImport = () => fileInputRef.current?.click();

  const previewImport = async (file: File | undefined) => {
    if (!file) return;
    setOperationBusy(true);
    try {
      const preview = await exchangeManager.preview(file, file.name);
      setPendingImportFile(file);
      setPendingImport(preview);
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setOperationBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const cancelImport = () => {
    setPendingImport(null);
    setPendingImportFile(null);
  };

  const confirmImport = async () => {
    if (!pendingImportFile) return;
    setOperationBusy(true);
    try {
      const result = await exchangeManager.import(pendingImportFile, pendingImportFile.name);
      cancelImport();
      setToast(`${result.inserted} added, ${result.merged} merged.`);
      await refreshCollections();
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setOperationBusy(false);
    }
  };

  const deleteHistory = async () => {
    if (activeDrive) {
      setToast('End the active drive before deleting drive history.');
      return;
    }
    setOperationBusy(true);
    try {
      await driveRepository.deleteHistory();
      setToast('Drive history deleted.');
      await refreshCollections();
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setOperationBusy(false);
    }
  };

  const deleteAllData = async () => {
    if (activeDrive) {
      setDeleteAllOpen(false);
      setToast('End the active drive before deleting app data.');
      return;
    }
    setOperationBusy(true);
    try {
      await clearAllLocalData(await getDatabase());
      const defaults = { ...DEFAULT_SETTINGS };
      setSettings(defaults);
      controller.updateSettings(defaults);
      setDeleteAllOpen(false);
      setOnboardingPage(0);
      setToast('All BumpCompanion data deleted.');
      await refreshCollections();
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      setOperationBusy(false);
    }
  };

  const startCalibration = async () => {
    setCalibrationRunning(true);
    setCalibrationError(null);
    const service = new BrowserCalibrationService();
    try {
      const profile = await service.calibrate();
      await calibrationRepository.save(profile);
      setCalibration(profile);
      setToast('Calibration complete.');
    } catch (error) {
      setCalibrationError(errorMessage(error));
    } finally {
      service.stop();
      setCalibrationRunning(false);
    }
  };

  const resetCalibration = async () => {
    try {
      await calibrationRepository.reset();
      setCalibration(null);
      setToast('Calibration reset.');
    } catch (error) {
      setToast(errorMessage(error));
    }
  };

  if (fatalError) {
    return <FatalScreen message={fatalError} />;
  }
  if (!ready) {
    return <BootScreen />;
  }
  if (!settings.onboardingComplete) {
    return (
      <Onboarding
        pageIndex={onboardingPage}
        onPageChange={setOnboardingPage}
        onComplete={completeOnboarding}
        onSkip={completeOnboarding}
      />
    );
  }

  let content: ReactNode;
  if (detail === 'review') {
    content = (
      <ReviewScreen
        candidates={candidates}
        metricUnits={settings.metricUnits}
        onBack={() => setDetail(null)}
        onDecision={(id, decision) => void decideCandidate(id, decision)}
        onConfirmProbable={() => void confirmProbable()}
      />
    );
  } else if (detail === 'calibration') {
    content = (
      <CalibrationScreen
        profile={calibration}
        running={calibrationRunning}
        error={calibrationError}
        onBack={() => setDetail(null)}
        onStart={() => void startCalibration()}
        onReset={() => void resetCalibration()}
      />
    );
  } else if (tab === 'home') {
    content = (
      <HomeScreen
        runtime={runtime}
        confirmedBumps={confirmedBumps}
        pendingCandidates={candidates.length}
        latestDrive={latestDrive}
        metricUnits={settings.metricUnits}
        detectionSupported={controller.detectionSupported}
        locationEnabled={locationEnabled}
        startDialogOpen={startDialogOpen}
        startBusy={startBusy}
        startError={startError}
        now={now}
        onOpenStartDialog={() => {
          setStartError(null);
          setStartDialogOpen(true);
        }}
        onCloseStartDialog={() => setStartDialogOpen(false)}
        onStartDrive={() => void startDrive()}
        onPause={() => runDriveAction(() => controller.pause())}
        onResume={() => runDriveAction(() => controller.resume())}
        onEndDrive={() => runDriveAction(() => controller.end())}
        onMarkBump={() => runDriveAction(() => controller.markBump())}
        onToggleMute={() => controller.toggleMute()}
        onOpenNavigation={openNavigation}
        onReviewCandidates={() => setDetail('review')}
      />
    );
  } else if (tab === 'bumps') {
    content = (
      <BumpsScreen
        items={visibleBumps}
        filter={bumpFilter}
        search={bumpSearch}
        view={bumpView}
        selectedBump={selectedBump}
        currentLocation={runtime.lastLocation}
        onFilterChange={setBumpFilter}
        onSearchChange={setBumpSearch}
        onViewChange={setBumpView}
        onSelectBump={setSelectedBump}
        onSaveBump={(bump) => void updateBump(bump)}
        onToggleWarning={(bump) => mutateBump(
          () => bumpRepository.setWarningEnabled(bump.id, !bump.warningEnabled),
          bump.warningEnabled ? 'Warnings disabled.' : 'Warnings enabled.'
        )}
        onArchive={(bump) => mutateBump(
          () => bumpRepository.setArchived(bump.id, !bump.archived),
          bump.archived ? 'Bump restored.' : 'Bump archived.'
        )}
        onMarkRemoved={(bump) => mutateBump(
          () => bumpRepository.markRemoved(bump.id),
          'Bump marked as removed.'
        )}
        onDelete={(bump) => mutateBump(
          () => bumpRepository.deleteBump(bump.id),
          'Bump deleted.'
        )}
        onOpenExternal={openExternalCoordinate}
      />
    );
  } else if (tab === 'drives') {
    content = <DrivesScreen drives={drives} metricUnits={settings.metricUnits} />;
  } else {
    content = (
      <SettingsScreen
        settings={settings}
        busy={operationBusy}
        pendingImport={pendingImport}
        deleteAllDialogOpen={deleteAllOpen}
        vibrationSupported={'vibrate' in navigator}
        onSensitivityChange={(value) => void saveSettings({ sensitivity: value })}
        onWarningsChange={(value) => void saveSettings({ warningsEnabled: value })}
        onVoiceChange={(value) => void saveSettings({ voiceEnabled: value })}
        onToneChange={(value) => void saveSettings({ toneEnabled: value })}
        onVibrationChange={(value) => void saveSettings({ vibrationEnabled: value })}
        onAdaptiveDistanceChange={(value) => void saveSettings({ adaptiveWarningDistance: value })}
        onRouteHistoryChange={(value) => void saveSettings({ routeHistoryEnabled: value })}
        onMetricUnitsChange={(value) => void saveSettings({ metricUnits: value })}
        onThemeChange={(value: ThemeMode) => void saveSettings({ themeMode: value })}
        onDynamicColourChange={(value) => void saveSettings({ dynamicColour: value })}
        onOpenCalibration={() => setDetail('calibration')}
        onExport={() => void exportBumps()}
        onImport={chooseImport}
        onDeleteHistory={() => void deleteHistory()}
        onRequestDeleteAll={() => setDeleteAllOpen(true)}
        onCancelDeleteAll={() => setDeleteAllOpen(false)}
        onConfirmDeleteAll={() => void deleteAllData()}
        onConfirmImport={() => void confirmImport()}
        onCancelImport={cancelImport}
        onOpenInstallHelp={() => setInstallHelpOpen(true)}
      />
    );
  }

  return (
    <>
      <AppShell
        activeTab={tab}
        onTabChange={changeTab}
        showNavigation={detail === null}
        driveActive={activeDrive}
      >
        {content}
      </AppShell>
      <input
        ref={fileInputRef}
        className="bc-visually-hidden"
        type="file"
        accept=".bumpcompanion,.json,application/json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void previewImport(event.currentTarget.files?.[0])}
      />
      <InstallHelp open={installHelpOpen} onDismiss={() => setInstallHelpOpen(false)} />
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <LoadingOverlay visible={operationBusy && tab !== 'settings'} />
    </>
  );
}

function BootScreen() {
  return (
    <main className="bc-boot" role="status" aria-label="Loading BumpCompanion">
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="96" height="96" />
      <h1>BumpCompanion</h1>
      <span className="bc-spinner" aria-hidden="true" />
    </main>
  );
}

function FatalScreen({ message }: { message: string }) {
  return (
    <main className="bc-fatal" role="alert">
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="88" height="88" />
      <h1>BumpCompanion could not open</h1>
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>Try again</button>
    </main>
  );
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    // The app is intentionally tracker-free; render a local recovery screen without transmitting data.
  }

  render(): ReactNode {
    return this.state.failed
      ? <FatalScreen message="Local app data could not be loaded safely." />
      : this.props.children;
  }
}
