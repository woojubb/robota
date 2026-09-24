import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { open, readFile as readFileAsync, rename, unlink as unlinkAsync, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The process `exit` handler below must be synchronous (Node does not wait for async work started
// during `exit`), so it uses `readFileSync`/`unlinkSync` rather than the promise-based functions used
// everywhere else here.

const OWNER_LOCK_FILE_NAME = '.owner.lock';

/**
 * The heartbeat lease timing. A live owner rewrites `refreshedAt` on this interval; a lock whose
 * `refreshedAt` is older than the lease timeout is stale REGARDLESS of host or pid, which is what
 * lets a genuinely dead owner's lock be reclaimed even when host-and-pid liveness cannot prove it
 * (a recreated container gets a new hostname and never runs Node's `exit` handler on
 * SIGTERM/SIGKILL; a reused pid on the same host can look alive forever). The margin between the two
 * is generous on purpose: a slow GC pause or scheduler hiccup must not make a live owner look dead.
 */
export const DEFAULT_LOCK_REFRESH_INTERVAL_MS = 5_000;
export const DEFAULT_LOCK_LEASE_TIMEOUT_MS = 30_000;

export interface IFileStoreOwnerLockOptions {
  /** How often the live owner rewrites its lease. Defaults to {@link DEFAULT_LOCK_REFRESH_INTERVAL_MS}. */
  refreshIntervalMs?: number;
  /** Age past which a lease is stale regardless of host or pid. Defaults to {@link DEFAULT_LOCK_LEASE_TIMEOUT_MS}. */
  leaseTimeoutMs?: number;
  /**
   * Called when a refresh discovers this instance no longer holds the lock (another owner took it
   * over — the lease lapsed during a long event-loop stall, for instance). The caller must stop
   * treating itself as the owner: it does not un-become a second owner on its own.
   */
  onOwnershipLost?: (reason: string) => void;
  /**
   * Deterministic re-entrancy probe for tests: called once at the end of every heartbeat refresh
   * (whatever its outcome), so a test driving the lease with fake timers can await a real refresh
   * cycle's actual completion instead of guessing how many event-loop turns real fs I/O needs.
   */
  afterRefresh?: () => void;
}

interface IOwnerLockRecord {
  pid: number;
  hostname: string;
  /** Distinguishes this acquisition from another with the same pid/hostname (e.g. a later
   *  acquisition in the same process after this one released or lost the lock). */
  token: string;
  /** Informational only; staleness is decided by `refreshedAt`, not this. */
  acquiredAt: string;
  /** Epoch ms of the last heartbeat. The authoritative clock for lease staleness. */
  refreshedAt: number;
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
    typeof (parsed as { hostname?: unknown }).hostname !== 'string' ||
    typeof (parsed as { token?: unknown }).token !== 'string' ||
    typeof (parsed as { refreshedAt?: unknown }).refreshedAt !== 'number'
  ) {
    return undefined;
  }
  return parsed as IOwnerLockRecord;
}

async function writeRecordAtomically(lockFilePath: string, record: IOwnerLockRecord): Promise<void> {
  const temporaryFilePath = `${lockFilePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(temporaryFilePath, JSON.stringify(record));
  await rename(temporaryFilePath, lockFilePath);
}

/**
 * Exclusive ownership of one file-storage root, backed by an `O_EXCL`-created lock file that its
 * live owner periodically refreshes — a heartbeat lease, not a one-shot claim.
 *
 * A storage root has exactly one live file-adapter owner (see the package SPEC): independent
 * instances hydrate their own in-memory working set and write whole-collection snapshots, so a
 * second live instance over the same root silently loses the first instance's updates. This lock
 * makes that contract fail loudly instead: acquiring it is the FIRST thing a `FileStoragePort`
 * instance does, before any hydration or read/write, so a conflicting second owner never gets far
 * enough to touch a collection file.
 *
 * Acquisition is `open(lockFile, 'wx')` — atomic create-if-absent. If the file already exists, the
 * recorded lease is inspected and treated as stale (eligible for takeover) when EITHER holds:
 * - its `refreshedAt` is older than the lease timeout — true regardless of host or pid, which is the
 *   general case: a container recreated after `docker stop`/a crash gets a new hostname and Node
 *   does not run `exit` handlers on SIGTERM/SIGKILL, so the old lease simply stops being renewed;
 * - it names a process on THIS host that `process.kill(pid, 0)` reports dead — a fast path for
 *   immediate takeover on the common same-host-crash case, without waiting out the full lease
 *   timeout. This is an optimization layered on the lease, not a substitute for it: a dead owner
 *   stops refreshing, so even if a reused pid makes this fast path say "alive", the lease timeout
 *   still reclaims the root once refreshing has actually stopped.
 *
 * A lock naming a different host, whose lease has not yet expired, is never taken over automatically
 * — this host cannot verify whether that owner is alive, so it is treated conservatively as live.
 *
 * Takeover is atomic: the retry after removing a stale lock file still goes through the same `wx`
 * create, so if another process races the same takeover, at most one of them observes success — the
 * loser sees `EEXIST` again on its own retry and fails instead of both believing they own the root.
 *
 * The live owner renews its lease on an unref'd interval. Each renewal first checks that the lock
 * file still names THIS acquisition (by a random per-acquisition token, not just pid/hostname, since
 * a later acquisition in the same process can share both) — if it does not, another owner has taken
 * over (this owner's lease lapsed during a long stall) and `onOwnershipLost` fires so the caller can
 * poison itself rather than silently continuing to write as an unaccounted-for second owner.
 *
 * Release removes the lock file (only if it still names this acquisition) on `close()` and,
 * best-effort, on process `exit` — `exit` handlers run synchronously, so that path uses the sync fs
 * functions and does not fire on SIGKILL or an unhandled crash.
 */
export class FileStoreOwnerLock {
  private released = false;
  private readonly token = randomUUID();
  private readonly exitHandler: () => void;
  private readonly refreshIntervalMs: number;
  private readonly leaseTimeoutMs: number;
  private readonly onOwnershipLost: ((reason: string) => void) | undefined;
  private readonly afterRefresh: (() => void) | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly lockFilePath: string,
    options: IFileStoreOwnerLockOptions,
  ) {
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_LOCK_REFRESH_INTERVAL_MS;
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? DEFAULT_LOCK_LEASE_TIMEOUT_MS;
    this.onOwnershipLost = options.onOwnershipLost;
    this.afterRefresh = options.afterRefresh;
    this.exitHandler = (): void => {
      try {
        const raw = readFileSync(this.lockFilePath, 'utf8');
        const record = parseLockRecord(raw);
        if (record && this.isOurs(record)) {
          unlinkSync(this.lockFilePath);
        }
      } catch {
        // Best-effort only: a missing file, a race with another cleanup, or a read error here must
        // never turn process shutdown into a crash. Also never fires on SIGKILL or a hard crash — the
        // heartbeat lease timeout is what reclaims the root in those cases, not this handler.
      }
    };
  }

  public static async acquire(
    storageRootPath: string,
    options: IFileStoreOwnerLockOptions = {},
  ): Promise<FileStoreOwnerLock> {
    const lockFilePath = path.join(storageRootPath, OWNER_LOCK_FILE_NAME);
    const lock = new FileStoreOwnerLock(lockFilePath, options);
    await lock.acquireInternal();
    return lock;
  }

  private isOurs(record: IOwnerLockRecord): boolean {
    return record.token === this.token;
  }

  private async acquireInternal(): Promise<void> {
    // Two attempts: a fresh create, and — only if the existing lease proves stale — one retry of the
    // same exclusive create. The retry is what makes takeover atomic: `wx` still admits only one
    // winner, so a second process racing the same stale takeover fails its own retry instead of both
    // instances believing they hold the root.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const created = await this.tryCreate();
      if (created) {
        this.startHeartbeat();
        return;
      }

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
        token: this.token,
        acquiredAt: new Date().toISOString(),
        refreshedAt: Date.now(),
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

    const ageMs = Date.now() - record.refreshedAt;
    const leaseExpired = ageMs > this.leaseTimeoutMs;
    const sameHostDead = record.hostname === os.hostname() && !isProcessAlive(record.pid);

    if (leaseExpired || sameHostDead) {
      return {
        stale: true,
        pid: record.pid,
        hostname: record.hostname,
        message: sameHostDead
          ? `owner process (pid ${record.pid}) is no longer alive`
          : `owner lease at ${path.dirname(this.lockFilePath)} last renewed ${String(ageMs)}ms ago, past the ${String(this.leaseTimeoutMs)}ms timeout`,
      };
    }

    if (record.hostname !== os.hostname()) {
      return {
        stale: false,
        pid: record.pid,
        hostname: record.hostname,
        message: `file store root ${path.dirname(this.lockFilePath)} is owned by pid ${record.pid} on host ${record.hostname}, with a lease renewed ${String(ageMs)}ms ago; ownership cannot be verified from host ${os.hostname()}, so it is treated as live until its lease lapses`,
      };
    }

    return {
      stale: false,
      pid: record.pid,
      hostname: record.hostname,
      message: `file store root ${path.dirname(this.lockFilePath)} is already owned by a live process (pid ${record.pid})`,
    };
  }

  private startHeartbeat(): void {
    const timer = setInterval(() => {
      void this.refresh();
    }, this.refreshIntervalMs);
    timer.unref?.();
    this.refreshTimer = timer;
  }

  private stopHeartbeat(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Renew the lease, first checking the lock file still names THIS acquisition. A stall long enough
   * for another owner to take the root over must be discovered here rather than let this instance
   * keep believing it is the owner.
   */
  private async refresh(): Promise<void> {
    if (this.released) return;
    try {
      let record: IOwnerLockRecord | undefined;
      try {
        const raw = await readFileAsync(this.lockFilePath, 'utf8');
        record = parseLockRecord(raw);
      } catch (error) {
        if (isErrnoException(error) && error.code === 'ENOENT') {
          this.handleOwnershipLost('lock file is gone — another owner may have taken over the root');
          return;
        }
        // A transient read failure (EMFILE/EACCES/...) is not proof of losing the lease; try again
        // on the next tick rather than poisoning the instance over a passing I/O hiccup.
        return;
      }
      if (!record || !this.isOurs(record)) {
        this.handleOwnershipLost('the storage root is now owned by a different instance');
        return;
      }
      try {
        await writeRecordAtomically(this.lockFilePath, { ...record, refreshedAt: Date.now() });
      } catch {
        // Same reasoning as the read above: a transient write failure does not by itself mean the
        // lease was lost. If it truly was, the NEXT refresh's read will see someone else's record.
      }
    } finally {
      this.afterRefresh?.();
    }
  }

  private handleOwnershipLost(reason: string): void {
    if (this.released) return;
    this.released = true;
    this.stopHeartbeat();
    process.removeListener('exit', this.exitHandler);
    this.onOwnershipLost?.(reason);
  }

  public async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    this.stopHeartbeat();
    process.removeListener('exit', this.exitHandler);
    try {
      const raw = await readFileAsync(this.lockFilePath, 'utf8');
      const record = parseLockRecord(raw);
      if (record && this.isOurs(record)) {
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
