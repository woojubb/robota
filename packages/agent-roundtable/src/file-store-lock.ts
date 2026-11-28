import { randomUUID } from 'node:crypto';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { RoundtableError } from './errors';
import {
  OWNER_ONLY_FILE,
  errorCode,
  linkExclusive,
  processIsAlive,
  sleep,
  tempPath,
} from './file-store-io';
import type { CheckpointHook } from './file-store-io';

export interface DirectoryLockOptions {
  /** How long a holder may keep the lock before another process may break it. */
  ttlMs: number;
  /** How long to wait for a live holder before giving up with `busy`. */
  waitMs: number;
  checkpoint?: CheckpointHook;
}

interface Holder {
  pid: number;
  host: string;
  token: string;
  expiresAt: number;
}

/**
 * A cross-process mutex over a create-only lock file that names its holder. It guards one short
 * read-modify-write. A lock whose process is gone, or whose expiry passed, is broken. A holder that
 * stalls past the expiry can lose the lock, so critical sections must stay short.
 */
export class DirectoryLock {
  constructor(
    private readonly path: string,
    private readonly options: DirectoryLockOptions,
  ) {}

  async run<T>(action: () => Promise<T>): Promise<T> {
    const token = await this.acquire();
    try {
      await this.options.checkpoint?.('lock-held');
      return await action();
    } finally {
      await this.release(token);
    }
  }

  private async acquire(): Promise<string> {
    const deadline = Date.now() + this.options.waitMs;
    for (;;) {
      const observed = await this.read();
      if (observed === undefined) {
        const token = await this.tryCreate();
        if (token) return token;
        continue;
      }
      if (await this.isStale(observed)) {
        await this.breakLock(observed);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new RoundtableError('busy', 'Conversation lock is held by another writer');
      }
      await sleep(5 + Math.random() * 10);
    }
  }

  private async tryCreate(): Promise<string | undefined> {
    const token = randomUUID();
    const holder: Holder = {
      pid: process.pid,
      host: hostname(),
      token,
      expiresAt: Date.now() + this.options.ttlMs,
    };
    const temp = tempPath(dirname(this.path), 'lock-');
    await writeFile(temp, JSON.stringify(holder), { flag: 'wx', mode: OWNER_ONLY_FILE });
    try {
      return (await linkExclusive(temp, this.path)) === 'created' ? token : undefined;
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }

  private async read(): Promise<string | undefined> {
    try {
      return await readFile(this.path, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async isStale(raw: string): Promise<boolean> {
    let holder: Partial<Holder> | undefined;
    try {
      holder = JSON.parse(raw) as Partial<Holder>;
    } catch {
      holder = undefined;
    }
    if (
      !holder ||
      typeof holder.pid !== 'number' ||
      typeof holder.expiresAt !== 'number' ||
      typeof holder.host !== 'string'
    ) {
      // A lock never appears partly written, so unreadable content is old damage; break it only once it has aged out.
      const info = await stat(this.path).catch(() => undefined);
      return info === undefined || Date.now() - info.mtimeMs > this.options.ttlMs;
    }
    if (holder.expiresAt <= Date.now()) return true;
    return holder.host === hostname() && !processIsAlive(holder.pid);
  }

  /** Moves the stale file aside atomically; if that took a fresh lock instead, puts it back. */
  private async breakLock(observed: string): Promise<void> {
    const aside = tempPath(dirname(this.path), 'broken-');
    try {
      await rename(this.path, aside);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    const moved = await readFile(aside, 'utf8').catch(() => undefined);
    if (moved !== undefined && moved !== observed) await linkExclusive(aside, this.path);
    await unlink(aside).catch(() => undefined);
  }

  private async release(token: string): Promise<void> {
    const raw = await this.read().catch(() => undefined);
    if (raw === undefined) return;
    try {
      if ((JSON.parse(raw) as Partial<Holder>).token === token) await unlink(this.path);
    } catch {
      // Already broken and replaced, or removed; nothing of ours remains to release.
    }
  }
}
