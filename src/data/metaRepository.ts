import { getDatabase, type BumpDatabase } from './database';

export class MetaRepository {
  constructor(private readonly database: BumpDatabase | Promise<BumpDatabase> = getDatabase()) {}

  async get<T>(key: string): Promise<T | undefined> {
    const record = await (await this.database).get('meta', key);
    return record?.value as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await (await this.database).put('meta', { key, value, updatedAt: Date.now() });
  }

  async delete(key: string): Promise<void> {
    await (await this.database).delete('meta', key);
  }
}
