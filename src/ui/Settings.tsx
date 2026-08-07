import {
  Activity,
  BellRing,
  CarFront,
  Download,
  LockKeyhole,
  Palette,
  Ruler,
  Share,
  SlidersHorizontal,
  Trash2,
  TrashIcon,
  Upload
} from 'lucide-react';
import {
  Sensitivity,
  ThemeMode,
  type AppSettings
} from '../core/models';
import {
  ActionRow,
  Button,
  Dialog,
  LoadingOverlay,
  Screen,
  SectionTitle,
  SegmentedControl,
  SwitchRow,
  TopBar
} from './Common';
import { formatDateTime } from './formatters';

export interface ImportPreviewView {
  fileName: string;
  exportedAt: number;
  bumpCount: number;
  invalidCount: number;
  sourceLabel?: string | null;
  coordinateBounds: string;
}

export interface SettingsScreenProps {
  settings: AppSettings;
  busy?: boolean;
  pendingImport?: ImportPreviewView | null;
  deleteAllDialogOpen: boolean;
  vibrationSupported?: boolean;
  onSensitivityChange: (value: Sensitivity) => void;
  onWarningsChange: (value: boolean) => void;
  onVoiceChange: (value: boolean) => void;
  onToneChange: (value: boolean) => void;
  onVibrationChange: (value: boolean) => void;
  onAdaptiveDistanceChange: (value: boolean) => void;
  onRouteHistoryChange: (value: boolean) => void;
  onMetricUnitsChange: (value: boolean) => void;
  onThemeChange: (value: ThemeMode) => void;
  onDynamicColourChange: (value: boolean) => void;
  onOpenCalibration: () => void;
  onExport: () => void;
  onImport: () => void;
  onDeleteHistory: () => void;
  onRequestDeleteAll: () => void;
  onCancelDeleteAll: () => void;
  onConfirmDeleteAll: () => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  onOpenInstallHelp?: () => void;
}

const SENSITIVITY_OPTIONS = [
  { value: Sensitivity.CONSERVATIVE, label: 'Conservative' },
  { value: Sensitivity.BALANCED, label: 'Balanced' },
  { value: Sensitivity.SENSITIVE, label: 'Sensitive' }
] as const;

const THEME_OPTIONS = [
  { value: ThemeMode.SYSTEM, label: 'System default' },
  { value: ThemeMode.LIGHT, label: 'Light' },
  { value: ThemeMode.DARK, label: 'Dark' }
] as const;

export function SettingsScreen(props: SettingsScreenProps) {
  const { settings } = props;
  return (
    <>
      <TopBar title="Settings" />
      <Screen className="bc-settings-screen">
        <div className="bc-settings-content">
          <SettingsSection title="Detection" icon={SlidersHorizontal}>
            <SegmentedControl
              label="Sensitivity"
              value={settings.sensitivity}
              options={SENSITIVITY_OPTIONS}
              onChange={props.onSensitivityChange}
            />
            <ActionRow label="Calibration" icon={Activity} onClick={props.onOpenCalibration} />
          </SettingsSection>

          <SettingsSection title="Warnings" icon={BellRing}>
            <SwitchRow label="Enable warnings" checked={settings.warningsEnabled} onChange={props.onWarningsChange} />
            <SwitchRow label="Voice" checked={settings.voiceEnabled} disabled={!settings.warningsEnabled} onChange={props.onVoiceChange} />
            <SwitchRow label="Tone" checked={settings.toneEnabled} disabled={!settings.warningsEnabled} onChange={props.onToneChange} />
            <SwitchRow
              label="Vibration"
              checked={settings.vibrationEnabled && (props.vibrationSupported ?? true)}
              disabled={!settings.warningsEnabled || props.vibrationSupported === false}
              summary={props.vibrationSupported === false ? 'Not available in this browser.' : undefined}
              onChange={props.onVibrationChange}
            />
            <SwitchRow
              label="Adaptive warning distance"
              checked={settings.adaptiveWarningDistance}
              disabled={!settings.warningsEnabled}
              onChange={props.onAdaptiveDistanceChange}
            />
          </SettingsSection>

          <SettingsSection title="Drive" icon={CarFront}>
            <SwitchRow
              label="Route-history recording"
              checked={settings.routeHistoryEnabled}
              summary="Save recent route points with drive history."
              onChange={props.onRouteHistoryChange}
            />
          </SettingsSection>

          <SettingsSection title="Units" icon={Ruler}>
            <SwitchRow label="Metric units" checked={settings.metricUnits} onChange={props.onMetricUnitsChange} />
          </SettingsSection>

          <SettingsSection title="Appearance" icon={Palette}>
            <SegmentedControl
              label="Dark mode"
              value={settings.themeMode}
              options={THEME_OPTIONS}
              onChange={props.onThemeChange}
            />
            <SwitchRow
              label="Dynamic colour"
              checked={false}
              disabled
              summary="Wallpaper-based colours are not available in iPhone browsers."
              onChange={props.onDynamicColourChange}
            />
          </SettingsSection>

          <SettingsSection title="Privacy and storage" icon={LockKeyhole}>
            <ActionRow label="Export bump list" icon={Upload} onClick={props.onExport} />
            <ActionRow label="Import bump list" icon={Download} onClick={props.onImport} />
            <ActionRow label="Delete drive history" icon={TrashIcon} onClick={props.onDeleteHistory} />
            <ActionRow label="Delete all app data" icon={Trash2} onClick={props.onRequestDeleteAll} destructive />
            {props.onOpenInstallHelp ? (
              <ActionRow label="Install on iPhone" icon={Share} onClick={props.onOpenInstallHelp} />
            ) : null}
          </SettingsSection>

          <p className="bc-settings-footnote">Your bump and drive data stays on this device unless you export it.</p>
          <p className="bc-safety-statement">BumpCompanion may miss bumps or give incorrect warnings. Always watch the road and drive safely.</p>
        </div>
      </Screen>

      <ImportPreviewDialog preview={props.pendingImport ?? null} onConfirm={props.onConfirmImport} onDismiss={props.onCancelImport} />
      <DeleteAllDialog
        open={props.deleteAllDialogOpen}
        onDismiss={props.onCancelDeleteAll}
        onConfirm={props.onConfirmDeleteAll}
      />
      <LoadingOverlay visible={props.busy ?? false} />
    </>
  );
}

function SettingsSection({
  title,
  icon: Icon,
  children
}: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <section className="bc-settings-section">
      <div className="bc-settings-section__title">
        <Icon aria-hidden="true" size={22} />
        <SectionTitle>{title}</SectionTitle>
      </div>
      <div className="bc-settings-section__content">{children}</div>
    </section>
  );
}

function ImportPreviewDialog({
  preview,
  onConfirm,
  onDismiss
}: {
  preview: ImportPreviewView | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <Dialog
      open={preview !== null}
      title="Review import"
      onDismiss={onDismiss}
      actions={(
        <>
          <Button tone="ghost" onClick={onDismiss}>Cancel</Button>
          <Button onClick={onConfirm}>Import</Button>
        </>
      )}
    >
      {preview ? (
        <dl className="bc-import-preview">
          <div><dt>File</dt><dd>{preview.fileName}</dd></div>
          <div><dt>Exported</dt><dd>{formatDateTime(preview.exportedAt)}</dd></div>
          <div><dt>Bumps</dt><dd>{preview.bumpCount}</dd></div>
          <div><dt>Invalid items</dt><dd>{preview.invalidCount}</dd></div>
          {preview.sourceLabel ? <div><dt>Source</dt><dd>{preview.sourceLabel}</dd></div> : null}
          <div><dt>Coordinate range</dt><dd>{preview.coordinateBounds}</dd></div>
        </dl>
      ) : null}
    </Dialog>
  );
}

function DeleteAllDialog({
  open,
  onDismiss,
  onConfirm
}: {
  open: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      title="Delete all data?"
      icon={Trash2}
      onDismiss={onDismiss}
      actions={(
        <>
          <Button tone="ghost" onClick={onDismiss}>Cancel</Button>
          <Button tone="danger" onClick={onConfirm}>Delete everything</Button>
        </>
      )}
    >
      <p>This permanently deletes saved bumps, detections, drive history, and settings.</p>
    </Dialog>
  );
}
