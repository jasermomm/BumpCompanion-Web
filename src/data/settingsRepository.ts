import {
  DEFAULT_SETTINGS,
  Sensitivity,
  ThemeMode,
  type AppSettings
} from '../core/models';
import { getDatabase, type BumpDatabase } from './database';

const SETTINGS_KEY = 'app';

export class SettingsRepository {
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(private readonly database: BumpDatabase | Promise<BumpDatabase> = getDatabase()) {}

  async get(): Promise<AppSettings> {
    const database = await this.database;
    const record = await database.get('settings', SETTINGS_KEY);
    return normalizeSettings(record?.value);
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const database = await this.database;
    const transaction = database.transaction('settings', 'readwrite');
    const existing = normalizeSettings((await transaction.store.get(SETTINGS_KEY))?.value);
    const value = normalizeSettings({ ...existing, ...patch });
    await transaction.store.put({ key: SETTINGS_KEY, value, updatedAt: Date.now() });
    await transaction.done;
    this.emit(value);
    return value;
  }

  async reset(): Promise<AppSettings> {
    const database = await this.database;
    await database.delete('settings', SETTINGS_KEY);
    const value = { ...DEFAULT_SETTINGS };
    this.emit(value);
    return value;
  }

  subscribe(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    void this.get().then(listener);
    return () => this.listeners.delete(listener);
  }

  setOnboardingComplete(value: boolean): Promise<AppSettings> {
    return this.update({ onboardingComplete: value });
  }

  setSensitivity(value: Sensitivity): Promise<AppSettings> {
    return this.update({ sensitivity: value });
  }

  setWarningsEnabled(value: boolean): Promise<AppSettings> {
    return this.update({ warningsEnabled: value });
  }

  setVoiceEnabled(value: boolean): Promise<AppSettings> {
    return this.update({ voiceEnabled: value });
  }

  setToneEnabled(value: boolean): Promise<AppSettings> {
    return this.update({ toneEnabled: value });
  }

  setVibrationEnabled(value: boolean): Promise<AppSettings> {
    return this.update({ vibrationEnabled: value });
  }

  setAdaptiveDistance(value: boolean): Promise<AppSettings> {
    return this.update({ adaptiveWarningDistance: value });
  }

  setRouteHistoryEnabled(value: boolean): Promise<AppSettings> {
    return this.update({ routeHistoryEnabled: value });
  }

  setMetricUnits(value: boolean): Promise<AppSettings> {
    return this.update({ metricUnits: value });
  }

  setThemeMode(value: ThemeMode): Promise<AppSettings> {
    return this.update({ themeMode: value });
  }

  setDynamicColour(value: boolean): Promise<AppSettings> {
    return this.update({ dynamicColour: value });
  }

  setReducedMotion(value: boolean): Promise<AppSettings> {
    return this.update({ reducedMotion: value });
  }

  private emit(settings: AppSettings): void {
    for (const listener of this.listeners) listener({ ...settings });
  }
}
export function normalizeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const defaults = DEFAULT_SETTINGS;
  return {
    onboardingComplete: booleanOr(value.onboardingComplete, defaults.onboardingComplete),
    sensitivity: enumOr(value.sensitivity, Sensitivity, defaults.sensitivity),
    warningsEnabled: booleanOr(value.warningsEnabled, defaults.warningsEnabled),
    voiceEnabled: booleanOr(value.voiceEnabled, defaults.voiceEnabled),
    toneEnabled: booleanOr(value.toneEnabled, defaults.toneEnabled),
    vibrationEnabled: booleanOr(value.vibrationEnabled, defaults.vibrationEnabled),
    adaptiveWarningDistance: booleanOr(
      value.adaptiveWarningDistance,
      defaults.adaptiveWarningDistance
    ),
    fixedWarningDistanceMetres: integerInRange(
      value.fixedWarningDistanceMetres,
      20,
      1_000,
      defaults.fixedWarningDistanceMetres
    ),
    warningCooldownSeconds: integerInRange(
      value.warningCooldownSeconds,
      0,
      3_600,
      defaults.warningCooldownSeconds
    ),
    routeHistoryEnabled: booleanOr(value.routeHistoryEnabled, defaults.routeHistoryEnabled),
    candidateNotificationEnabled: booleanOr(
      value.candidateNotificationEnabled,
      defaults.candidateNotificationEnabled
    ),
    metricUnits: booleanOr(value.metricUnits, defaults.metricUnits),
    themeMode: enumOr(value.themeMode, ThemeMode, defaults.themeMode),
    dynamicColour: booleanOr(value.dynamicColour, defaults.dynamicColour),
    reducedMotion: booleanOr(value.reducedMotion, defaults.reducedMotion),
    repeatEvidenceAutoConfirmation: booleanOr(
      value.repeatEvidenceAutoConfirmation,
      defaults.repeatEvidenceAutoConfirmation
    )
  };
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integerInRange(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function enumOr<T extends string>(
  value: unknown,
  values: Record<string, T>,
  fallback: T
): T {
  return typeof value === 'string' && Object.values(values).includes(value as T)
    ? (value as T)
    : fallback;
}
