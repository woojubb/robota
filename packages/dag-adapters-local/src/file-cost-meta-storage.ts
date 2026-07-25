import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ICostMetaStoragePort } from '@robota-sdk/dag-cost';
import type { ICostMeta } from '@robota-sdk/dag-cost';

/** Owner read/write only — no group or other access (SEC-003 / CWE-377). */
const OWNER_ONLY_FILE_MODE = 0o600;

export class FileCostMetaStorage implements ICostMetaStoragePort {
  private readonly filePath: string;
  private cache: Map<string, ICostMeta>;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'cost-meta.json');
    this.cache = this.loadFromFile();
  }

  async get(nodeType: string): Promise<ICostMeta | undefined> {
    return this.cache.get(nodeType);
  }

  async getAll(): Promise<ICostMeta[]> {
    return Array.from(this.cache.values());
  }

  async save(meta: ICostMeta): Promise<void> {
    this.cache.set(meta.nodeType, meta);
    this.writeToFile();
  }

  async delete(nodeType: string): Promise<void> {
    this.cache.delete(nodeType);
    this.writeToFile();
  }

  private loadFromFile(): Map<string, ICostMeta> {
    if (!existsSync(this.filePath)) return new Map();
    const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as ICostMeta[];
    return new Map(data.map((m) => [m.nodeType, m]));
  }

  private writeToFile(): void {
    const data = Array.from(this.cache.values());
    // SEC-003: `dataDir` is caller-supplied and may be a shared location, so pin the
    // file to owner-only permissions instead of inheriting the process umask.
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), {
      encoding: 'utf-8',
      mode: OWNER_ONLY_FILE_MODE,
    });
  }
}
