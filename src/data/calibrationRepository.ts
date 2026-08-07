import type { CalibrationProfile } from '../core/models';
import { getDatabase, type BumpDatabase } from './database';

export class CalibrationRepository {
  constructor(private readonly database: BumpDatabase | Promise<BumpDatabase> = getDatabase()) {}

  async latest(): Promise<CalibrationProfile | null> {
    const profiles = await (await this.database).getAll('calibrations');
    return profiles.sort((first, second) => second.createdAt - first.createdAt)[0] ?? null;
  }

  async save(profile: CalibrationProfile): Promise<void> {
    await (await this.database).put('calibrations', profile);
  }

  async reset(): Promise<void> {
    await (await this.database).clear('calibrations');
  }
}
