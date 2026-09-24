import { readFileSync, unlinkSync } from 'node:fs';
import { open, readFile as readFileAsync, unlink as unlinkAsync } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The process `exit` handler below must be synchronous (Node does not wait for async work started
// during `exit`), so it uses `readFileSync`/`unlinkSync` rather than the promise-based functions used
// everywhere else here.

const OWNER_LOCK_FILE_NAME = '.owner.lock';

interface IOwnerLockRecord {
  pid: number;
  hostname: string;
  acquiredAt: string;
}

/**
 * Thrown when a storage root's owner lock is held by another live owner, or by an owner this host
 * cannot vouch for. Callers see this before any read or write reaches the collection files.
 */
export class FileStoreOwnerConflictError extends Error {
  public constructor(
    message: string,
    public readonly ownerPid?: number,
    public readonly ownerHostname?: string,
  ) {
    super(message);
    this.name = 'FileStoreOwnerConflictError';
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** `process.kill(pid, 0)` liveness probe. Same-host only — see {@link FileStoreOwnerLock}. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ESRCH') return false;
    // EPERM means the process exists but signalling it is not permitted — still alive.
    return true;
  }
}

function parseLockRecord(raw: string): IOwnerLockRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { pid?: unknown }).pid !== 'number' ||
    typeof (parsed as { hostname?: unknown }).hostname !== 'string'
  ) {
    return undefined;
  }
  return parsed as IOwnerLockRecord;
}

/**
 * Exclusive ownership of one file-storage root, backed by an `O_EXCL`-created lock file.
 *
 * A storage root has exactly one live file-adapter owner (see the package SPEC): independent
 * instances hydrate their own in-memory working set and write whole-collection snapshots, so a
 * second live instance over the same root silently loses the first instance's updates. This lock
 * makes that contract fail loudly instead: acquiring it is the FIRST thing a `FileStoragePort`
 * instance does, before any hydration or read/write, so a conflicting second owner never gets far
 * enough to touch a collection file.
 *
 * Acquisition is `open(lockFile, 'wx')` — atomic create-if-absent. If the file already exists, the
 * recorded owner is inspected:
 * - a different host: never taken over automatically (this host cannot verify liveness across
 *   hosts, so a live owner elsewhere is not distinguishable from a dead one — treated conservatively
 *   as live);
 * - this host, live (`process.kill(pid, 0)` succeeds or fails with `EPERM`): rejected;
 * - this host, dead (`process.kill(pid, 0)` fails with `ESRCH`): the stale lock file is removed and
 *   creation is retried. The retry still goes through the same `wx` create, so if another process
 *   races the same takeover, at most one of them observes success — the loser sees `EEXIST` again on
 *   its own retry and fails instead of both believing they own the root.
 *
 * Release removes the lock file (only if it still names this process) on `close()` and, best-effort,
 * on process `exit` — `exit` handlers run synchronously, so that path uses the sync fs functions.
 */
export class FileStoreOwnerLock {
  private released = false;
  private readonly exitHandler: () => void;

  private constructor(private readonly lockFilePath: string) {
    this.exitHandler = (): void => {
      try {
        const raw = readFileSync(this.lockFilePath, 'utf8');
        const record = parseLockRecord(raw);
        if (record && record.pid === process.pid && record.hostname === os.hostname()) {
          unlinkSync(this.lockFilePath);
        }
      } catch {
        // Best-effort only: a missing file, a race with another cleanup, or a read error here must
        // never turn process shutdown into a crash.
      }
    };
  }

  public static async acquire(storageRootPath: string): Promise<FileStoreOwnerLock> {
    const lockFilePath = path.join(storageRootPath, OWNER_LOCK_FILE_NAME);
    const lock = new FileStoreOwnerLock(lockFilePath);
    await lock.acquireInternal();
    return lock;
  }

  private async acquireInternal(): Promise<void> {
    // Two attempts: a fresh create, and — only if the existing lock proves stale — one retry of the
    // same exclusive create. The retry is what makes takeover atomic: `wx` still admits only one
    // winner, so a second process racing the same stale takeover fails its own retry instead of both
    // instances believing they hold the root.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const created = await this.tryCreate();
      if (created) return;

      const inspection = await this.inspectExistingLock();
      if (!inspection.stale) {
        throw new FileStoreOwnerConflictError(
          inspection.message,
          inspection.pid,
          inspection.hostname,
        );
      }
      // Stale (or already gone): remove it and let the loop retry the exclusive create.
      await unlinkAsync(this.lockFilePath).catch((error: unknown) => {
        if (isErrnoException(error) && error.code === 'ENOENT') return;
        throw error;
      });
    }
    throw new FileStoreOwnerConflictError(
      `file store owner lock at ${this.lockFilePath} could not be acquired: another owner won a concurrent takeover`,
    );
  }

  private async tryCreate(): Promise<boolean> {
    let handle;
    try {
      handle = await open(this.lockFilePath, 'wx');
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') return false;
      throw error;
    }
    try {
      const record: IOwnerLockRecord = {
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString(),
      };
      await handle.writeFile(JSON.stringify(record));
    } finally {
      await handle.close();
    }
    process.once('exit', this.exitHandler);
    return true;
  }

  private async inspectExistingLock(): Promise<{
    stale: boolean;
    message: string;
    pid?: number;
    hostname?: string;
  }> {
    let raw: string;
    try {
      raw = await readFileAsync(this.lockFilePath, 'utf8');
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        // Released between our failed create and this read — not stale, just gone. Safe to retry.
        return { stale: true, message: 'lock file was released concurrently' };
      }
      throw error;
    }

    const record = parseLockRecord(raw);
    if (!record) {
      // Unreadable content could be a half-written file from a genuinely dead owner, or something a
      // person or tool put there deliberately. Neither is distinguishable from here, so this refuses
      // automatic takeover rather than guessing.
      return {
        stale: false,
        message: `file store owner lock at ${this.lockFilePath} has unreadable contents; remove it manually once you have confirmed no other process owns ${path.dirname(this.lockFilePath)}`,
      };
    }

    if (record.hostname !== os.hostname()) {
      return {
        stale: false,
        pid: record.pid,
        hostname: record.hostname,
        message: `file store root ${path.dirname(this.lockFilePath)} is owned by pid ${record.pid} on host ${record.hostname}; ownership cannot be verified from host ${os.hostname()}, so it is treated as live`,
      };
    }

    if (isProcessAlive(record.pid)) {
      return {
        stale: false,
        pid: record.pid,
        hostname: record.hostname,
        message: `file store root ${path.dirname(this.lockFilePath)} is already owned by a live process (pid ${record.pid})`,
      };
    }

    return {
      stale: true,
      pid: record.pid,
      hostname: record.hostname,
      message: `owner process (pid ${record.pid}) is no longer alive`,
    };
  }

  public async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    process.removeListener('exit', this.exitHandler);
    try {
      const raw = await readFileAsync(this.lockFilePath, 'utf8');
      const record = parseLockRecord(raw);
      if (record && record.pid === process.pid && record.hostname === os.hostname()) {
        await unlinkAsync(this.lockFilePath).catch((error: unknown) => {
          if (isErrnoException(error) && error.code === 'ENOENT') return;
          throw error;
        });
      }
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return;
      // Best-effort: releasing must not throw and mask the caller's own close()/dispose path.
    }
  }
}
