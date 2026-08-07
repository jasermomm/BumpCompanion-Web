import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sensitivity, ThemeMode, DEFAULT_SETTINGS } from '../../src/core/models';
import { deleteBumpDatabase, openBumpDatabase } from '../../src/data/database';
import { SettingsRepository } from '../../src/data/settingsRepository';

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => deleteBumpDatabase(name)));
});
async function fixture() {
  const name = `settings-${crypto.randomUUID()}`;
  names.push(name);
  const database = await openBumpDatabase(name);
  return { database, repository: new SettingsRepository(database) };
}

describe('SettingsRepository', () => {
  it('returns Android defaults and persists every web setting', async () => {
    const { database, repository } = await fixture();
    expect(await repository.get()).toEqual(DEFAULT_SETTINGS);

    const updated = await repository.update({
      onboardingComplete: true,
      sensitivity: Sensitivity.SENSITIVE,
      warningsEnabled: false,
      fixedWarningDistanceMetres: 250,
      warningCooldownSeconds: 90,
      routeHistoryEnabled: true,
      candidateNotificationEnabled: true,
      metricUnits: false,
      themeMode: ThemeMode.DARK,
      dynamicColour: false,
      reducedMotion: true,
      repeatEvidenceAutoConfirmation: true
    });
    expect(updated.sensitivity).toBe(Sensitivity.SENSITIVE);
    expect(await new SettingsRepository(database).get()).toEqual(updated);
    database.close();
  });

  it('normalizes corrupted or out-of-range values and resets cleanly', async () => {
    const { database, repository } = await fixture();
    await database.put('settings', {
      key: 'app',
      value: {
        ...DEFAULT_SETTINGS,
        sensitivity: 'INVALID',
        themeMode: 'NEON',
        fixedWarningDistanceMetres: -1,
        warningCooldownSeconds: 9_999
      } as never,
      updatedAt: 1
    });
    expect(await repository.get()).toEqual(DEFAULT_SETTINGS);
    await repository.update({ warningsEnabled: false });
    expect((await repository.get()).warningsEnabled).toBe(false);
    expect(await repository.reset()).toEqual(DEFAULT_SETTINGS);
    expect(await repository.get()).toEqual(DEFAULT_SETTINGS);
    database.close();
  });

  it('notifies subscribers after updates and reset', async () => {
    const { database, repository } = await fixture();
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    await repository.setThemeMode(ThemeMode.DARK);
    await repository.reset();
    expect(listener).toHaveBeenLastCalledWith(DEFAULT_SETTINGS);
    unsubscribe();
    database.close();
  });
});
