import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import {
  link,
  open,
  readFile as readFileAsync,
  rename,
  stat,
  unlink as unlinkAsync,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OWNER_LOCK_FILE_NAME = '.owner.lock';
/** Suffix, not a standalone filename: the guard always lives alongside a specific lock file, as
 *  `${lockFilePath}${TAKEOVER_GUARD_SUFFIX}` (e.g. `.owner.lock.takeover`). */
const TAKEOVER_GUARD_SUFFIX = '.takeover';
/** Bounded so a pathological number of concurrent racers cannot loop forever; real contention (a
 *  handful of processes racing one stale lock) resolves in a small number of retries. */
const MAX_ACQUIRE_ATTEMPTS = 50;

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

/**
 * How the self-expiry threshold is derived from the refresh interval and lease timeout when not
 * given explicitly. It must be strictly less than the lease timeout, with enough margin that clock
 * drift and timer jitter cannot let another opener legitimately claim the root before this owner has
 * stopped acting: `leaseTimeoutMs - 2 * refreshIntervalMs` gives up two whole heartbeats of slack
 * (a single missed tick — a slow write, a GC pause — must not self-poison a live owner), clamped to
 * never go below one refresh interval (a degenerate config, e.g. `refreshIntervalMs` close to
 * `leaseTimeoutMs`, must not make self-expiry fire on the very first missed tick) or above
 * `leaseTimeoutMs - 1` (self-expiry must always precede the lease timeout by at least 1ms).
 */
export function computeSelfExpiryMs(refreshIntervalMs: number, leaseTimeoutMs: number): number {
  const withMargin = leaseTimeoutMs - 2 * refreshIntervalMs;
  return Math.min(Math.max(withMargin, refreshIntervalMs), leaseTimeoutMs - 1);
}

export interface IFileStoreOwnerLockOptions {
  /** How often the live owner rewrites its lease. Defaults to {@link DEFAULT_LOCK_REFRESH_INTERVAL_MS}. */
  refreshIntervalMs?: number;
  /** Age past which a lease is stale regardless of host or pid. Defaults to {@link DEFAULT_LOCK_LEASE_TIMEOUT_MS}. */
  leaseTimeoutMs?: number;
  /**
   * Age since this instance's own last SUCCESSFUL lease renewal past which it must stop acting as
   * owner, even before anything else has taken the root over. Must be strictly less than
   * `leaseTimeoutMs` — see {@link computeSelfExpiryMs} for the default and its reasoning. Exposed
   * mainly for tests; production callers should not normally need to override the default.
   */
  selfExpiryMs?: number;
  /**
   * Called when this instance stops holding the lock — either because another owner's token now
   * occupies it, or because this instance self-expired. The caller must stop treating itself as the
   * owner until (if ever) {@link FileStoreOwnerLock.tryRecover} succeeds.
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

interface IStaleInspection {
  stale: boolean;
  message: string;
  pid?: number;
  hostname?: string;
  /** The token this inspection judged — for a guarded takeover to confirm it is acting on the exact
   *  acquisition it judged stale, not a different one that has since replaced it. */
  observedToken?: string;
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

async function unlinkIgnoringMissing(filePath: string): Promise<void> {
  await unlinkAsync(filePath).catch((error: unknown) => {
    if (isErrnoException(error) && error.code === 'ENOENT') return;
    throw error;
  });
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

/** mtime of a path, or `undefined` if it no longer exists. Any other stat failure is rethrown. */
async function statMtimeMs(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeRecordAtomically(lockFilePath: string, record: IOwnerLockRecord): Promise<void> {
  const temporaryFilePath = `${lockFilePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryFilePath, JSON.stringify(record));
    await rename(temporaryFilePath, lockFilePath);
  } catch (error) {
    await unlinkIgnoringMissing(temporaryFilePath);
    throw error;
  }
}

// A SINGLE module-level `exit` listener, rather than one per lock: many `FileStoragePort`s can be
// acquired and released over a process's lifetime (tests do this heavily), and a per-instance
// `process.once('exit', ...)` would otherwise accumulate one listener per acquisition. `liveLocks`
// holds every lock this process has ever successfully created or reacquired; each entry's own
// `isOurs()` check on exit means an entry that has since lost its lease to another owner is a
// harmless no-op here, so nothing needs to actively prune the set on ownership loss — only an
// explicit `release()` removes an entry, since that is the only case a cleanup has already run.
const liveLocks = new Set<FileStoreOwnerLock>();
let exitHandlerRegistered = false;

function ensureProcessExitHandlerRegistered(): void {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;
  process.once('exit', () => {
    for (const lock of liveLocks) lock.cleanupOnExitSync();
  });
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
 * ASSUMES roughly synchronized clocks across hosts sharing a storage root (e.g. over a network
 * filesystem): lease age is `Date.now()` on the READING host minus a timestamp written by the
 * OWNING host. A host far enough ahead can see a live remote lease as prematurely stale; a host far
 * enough behind can delay reclaiming a genuinely dead one. This is not compensated for.
 *
 * Creation writes the full record to a uniquely-named temp file first and `link()`s it to the lock
 * path — atomic and exclusive like `open(path, 'wx')`, but the lock path only ever names a fully
 * written file, never a partial one from an interrupted write.
 *
 * If the lock path already exists, the recorded lease is inspected and treated as stale (eligible
 * for takeover) when ANY of these hold:
 * - its `refreshedAt` is older than the lease timeout — true regardless of host or pid, which is the
 *   general case: a container recreated after `docker stop`/a crash gets a new hostname and Node
 *   does not run `exit` handlers on SIGTERM/SIGKILL, so the old lease simply stops being renewed;
 * - it names a process on THIS host that `process.kill(pid, 0)` reports dead — a fast path for
 *   immediate takeover on the common same-host-crash case, without waiting out the full lease
 *   timeout. This is an optimization layered on the lease, not a substitute for it: a dead owner
 *   stops refreshing, so even if a reused pid makes this fast path say "alive", the lease timeout
 *   still reclaims the root once refreshing has actually stopped;
 * - its contents are unparseable AND its mtime is older than the lease timeout — an unparseable file
 *   that is still young could be mid-write by a live owner (creation is atomic, but this is a defence
 *   in depth, not a claim that it is reachable in practice); an old one is presumed abandoned.
 *
 * A lock naming a different host, whose lease has not yet expired, is never taken over automatically
 * — this host cannot verify whether that owner is alive, so it is treated conservatively as live.
 *
 * TAKEOVER OF A STALE LOCK IS SERIALIZED by a second, short-lived exclusive file (the "takeover
 * guard"): a bare `unlink` of a stale lock followed by an unconditional create is NOT atomic across
 * two racing takers — both can independently judge the SAME lock stale, both `unlink` it (the second
 * `unlink` racing whichever the first taker has already recreated), and both then `open(.., 'wx')`
 * successfully, each believing it alone won. The guard makes "judge stale, remove, create" one
 * critical section: only the taker holding the guard re-reads the lock (to confirm it STILL carries
 * the exact token judged stale, and is STILL stale — the original owner may have renewed it while
 * the guard was contested) before unlinking and creating. A guard itself found older than the lease
 * timeout is presumed abandoned (its holder crashed mid-takeover) and is removed via `rename` to a
 * unique name — atomic, so of any number of racing cleanup attempts at most one renames the real
 * guard and the rest see `ENOENT` — before that renamer alone unlinks the renamed copy.
 *
 * The live owner renews its lease on an unref'd interval. Each renewal first checks that the lock
 * file still names THIS acquisition (by a random per-acquisition token, not just pid/hostname, since
 * a later acquisition in the same process can share both) — if it does not, another owner has taken
 * over (this owner's lease lapsed during a long stall) and `onOwnershipLost` fires so the caller can
 * poison itself rather than silently continuing to write as an unaccounted-for second owner.
 *
 * An owner must stop acting before anyone else may consider its lease stale — a heartbeat that keeps
 * FAILING to write (an unwritable directory, a stalled event loop that only gets to run once the
 * failure has been going on for a while) would otherwise leave this instance still believing it owns
 * the root right up until it happens to observe someone else's takeover, which is a lost-update
 * window rather than a guarantee. `checkSelfExpiry()` closes that window from the other direction: it
 * tracks this instance's own last SUCCESSFUL renewal (the initial acquisition counts), and self-
 * poisons once that is older than `selfExpiryMs` — a threshold kept strictly below `leaseTimeoutMs`
 * (see {@link computeSelfExpiryMs}) — regardless of whether anyone has actually taken the root over
 * yet. It runs on every heartbeat tick (once at the start of a refresh, and again immediately before
 * the rename that renews it, since the intervening read can itself stall) and is exposed for a caller
 * to also run it before every persist, since a stall long enough to matter delays both equally, and
 * whichever runs first when the event loop resumes must still catch it.
 *
 * Losing the lock — to a real takeover or to self-expiry — is not necessarily permanent:
 * {@link tryRecover} lets a caller check, on its next operation, whether nothing actually took over
 * (this instance's own token is still recorded — a false-alarm self-expiry, e.g. from writes that
 * have since started succeeding again) or whether the root can be freshly reacquired (the lock is now
 * gone or stale). Only a live, DIFFERENT token leaves it permanently lost.
 *
 * Release removes the lock file (only if it still names this acquisition) on `close()` and,
 * best-effort, on process `exit` via one shared process-level handler (see `liveLocks` above) — `exit`
 * handlers run synchronously, so that path uses the sync fs functions and does not fire on SIGKILL or
 * an unhandled crash.
 */
export class FileStoreOwnerLock {
  private released = false;
  private readonly token = randomUUID();
  private readonly refreshIntervalMs: number;
  private readonly leaseTimeoutMs: number;
  private readonly selfExpiryMs: number;
  private readonly onOwnershipLost: ((reason: string) => void) | undefined;
  private readonly afterRefresh: (() => void) | undefined;
  private readonly guardPath: string;
  private refreshTimer: NodeJS.Timeout | undefined;
  /** Epoch ms of this instance's own last SUCCESSFUL lease renewal; the initial acquisition counts. */
  private lastSuccessfulRefreshAt = 0;

  private constructor(
    private readonly lockFilePath: string,
    options: IFileStoreOwnerLockOptions,
  ) {
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_LOCK_REFRESH_INTERVAL_MS;
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? DEFAULT_LOCK_LEASE_TIMEOUT_MS;
    this.selfExpiryMs =
      options.selfExpiryMs ?? computeSelfExpiryMs(this.refreshIntervalMs, this.leaseTimeoutMs);
    this.onOwnershipLost = options.onOwnershipLost;
    this.afterRefresh = options.afterRefresh;
    this.guardPath = `${this.lockFilePath}${TAKEOVER_GUARD_SUFFIX}`;
  }

  public static async acquire(
    storageRootPath: string,
    options: IFileStoreOwnerLockOptions = {},
  ): Promise<FileStoreOwnerLock> {
    const lockFilePath = path.join(storageRootPath, OWNER_LOCK_FILE_NAME);
    const lock = new FileStoreOwnerLock(lockFilePath, options);
    const acquired = await lock.acquireInternal();
    // `acquired` is `true` or a `FileStoreOwnerConflictError` INSTANCE — an object, and therefore
    // truthy, so `if (!acquired)` would never see the failure case at all. Check identity, not
    // truthiness.
    if (acquired !== true) {
      throw acquired;
    }
    return lock;
  }

  private isOurs(record: IOwnerLockRecord): boolean {
    return record.token === this.token;
  }

  /**
   * Returns `undefined` on success (acquired or taken over), or the last conflict encountered if
   * every attempt was refused outright (a live owner — not merely contested by other takers).
   */
  private async acquireInternal(): Promise<FileStoreOwnerConflictError | true> {
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
      const created = await this.tryCreate();
      if (created) {
        this.startHeartbeat();
        return true;
      }

      const inspection = await this.inspectExistingLock();
      if (!inspection.stale) {
        return new FileStoreOwnerConflictError(
          inspection.message,
          inspection.pid,
          inspection.hostname,
        );
      }
      const tookOver = await this.attemptGuardedTakeover(inspection.observedToken);
      if (tookOver) {
        this.startHeartbeat();
        return true;
      }
      // The guard was contested, the lock was no longer the exact stale one judged, or a fresh
      // create raced in during the guarded critical section — retry the whole detect-and-take loop.
    }
    return new FileStoreOwnerConflictError(
      `file store owner lock at ${this.lockFilePath} is contested by concurrent takeover attempts`,
    );
  }

  private async tryCreate(): Promise<boolean> {
    const now = Date.now();
    const record: IOwnerLockRecord = {
      pid: process.pid,
      hostname: os.hostname(),
      token: this.token,
      acquiredAt: new Date(now).toISOString(),
      refreshedAt: now,
    };
    const temporaryFilePath = `${this.lockFilePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      // Write the FULL record to a scratch file first, then atomically publish it under the lock
      // path with `link` — which, like `open(.., 'wx')`, fails with `EEXIST` if the path is already
      // taken, but never exposes a partially written lock file the way create-then-write can.
      await writeFile(temporaryFilePath, JSON.stringify(record));
      try {
        await link(temporaryFilePath, this.lockFilePath);
      } catch (error) {
        if (isErrnoException(error) && error.code === 'EEXIST') return false;
        throw error;
      }
    } finally {
      await unlinkIgnoringMissing(temporaryFilePath);
    }
    this.lastSuccessfulRefreshAt = now;
    this.released = false;
    liveLocks.add(this);
    ensureProcessExitHandlerRegistered();
    return true;
  }

  /**
   * Serialize takeover of a lock judged stale: only the holder of `guardPath` may act on it, and it
   * re-confirms the lock is still the EXACT acquisition (`expectedToken`) it judged stale — and still
   * stale — before unlinking and recreating. Returns `false` (never throws for contention) whenever
   * this attempt did not end up owning the root, so the caller's retry loop can just try again.
   */
  private async attemptGuardedTakeover(expectedToken: string | undefined): Promise<boolean> {
    if (!(await this.acquireGuard())) return false;
    try {
      const recheck = await this.inspectExistingLock();
      if (!recheck.stale) return false; // the original owner renewed while the guard was contested
      if (expectedToken !== undefined && recheck.observedToken !== expectedToken) return false; // already replaced

      await unlinkIgnoringMissing(this.lockFilePath);
      // Nobody else can be mid-takeover of THIS lock while we hold the guard, but a brand-new
      // acquirer's FRESH `tryCreate()` (one that never saw an existing file to judge stale at all)
      // can still race the gap between our unlink and create — handled like any other create: EEXIST
      // just means we lost this attempt.
      return await this.tryCreate();
    } finally {
      await this.releaseGuard();
    }
  }

  private async acquireGuard(): Promise<boolean> {
    try {
      const handle = await open(this.guardPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, hostname: os.hostname() }));
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;
    }
    await this.reclaimStaleGuardIfAbandoned();
    return false;
  }

  private async releaseGuard(): Promise<void> {
    await unlinkIgnoringMissing(this.guardPath);
  }

  /**
   * A guard older than the lease timeout is presumed abandoned (its holder crashed mid-takeover,
   * never reaching its own `finally`). Cleanup is itself a race between every process that notices —
   * `rename` to a unique name is the atomic single-winner step: at most one renamer sees the guard
   * still at `guardPath`, and every other sees `ENOENT` and does nothing further.
   */
  private async reclaimStaleGuardIfAbandoned(): Promise<void> {
    const mtimeMs = await statMtimeMs(this.guardPath).catch(() => undefined);
    if (mtimeMs === undefined || Date.now() - mtimeMs <= this.leaseTimeoutMs) return;

    const disposalPath = `${this.guardPath}.stale-${randomUUID()}`;
    try {
      await rename(this.guardPath, disposalPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return; // someone else already won
      return; // best-effort cleanup path; never throw out of it
    }
    await unlinkIgnoringMissing(disposalPath);
  }

  private async inspectExistingLock(): Promise<IStaleInspection> {
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
      // Unreadable content could be a half-written file from a genuinely dead owner (creation is
      // atomic now, but this is defence in depth), or something a person or tool put there
      // deliberately. Age is the only signal available: young is left alone, old is presumed
      // abandoned.
      const mtimeMs = await statMtimeMs(this.lockFilePath).catch(() => undefined);
      const abandoned = mtimeMs !== undefined && Date.now() - mtimeMs > this.leaseTimeoutMs;
      return abandoned
        ? { stale: true, message: `file store owner lock at ${this.lockFilePath} has unreadable contents older than the lease timeout` }
        : {
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
        observedToken: record.token,
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
        observedToken: record.token,
        message: `file store root ${path.dirname(this.lockFilePath)} is owned by pid ${record.pid} on host ${record.hostname}, with a lease renewed ${String(ageMs)}ms ago; ownership cannot be verified from host ${os.hostname()}, so it is treated as live until its lease lapses`,
      };
    }

    return {
      stale: false,
      pid: record.pid,
      hostname: record.hostname,
      observedToken: record.token,
      message: `file store root ${path.dirname(this.lockFilePath)} is already owned by a live process (pid ${record.pid})`,
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
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
      this.checkSelfExpiry();
      if (this.released) return;

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
        // on the next tick rather than poisoning the instance over a passing I/O hiccup. If the
        // failure persists, `checkSelfExpiry()` (above, next tick, and before every persist) is what
        // eventually stops this instance — a failed READ never itself counts as a successful renewal.
        return;
      }
      if (!record || !this.isOurs(record)) {
        this.handleOwnershipLost('the storage root is now owned by a different instance');
        return;
      }

      // Re-check immediately before the rename: the read above can itself stall long enough that
      // self-expiry should have already fired.
      this.checkSelfExpiry();
      if (this.released) return;

      try {
        const refreshedAt = Date.now();
        await writeRecordAtomically(this.lockFilePath, { ...record, refreshedAt });
        this.lastSuccessfulRefreshAt = refreshedAt;
      } catch {
        // Same reasoning as the read above: a transient write failure does not by itself mean the
        // lease was lost, and does not update `lastSuccessfulRefreshAt`. If failures persist past
        // `selfExpiryMs`, `checkSelfExpiry()` is what stops this instance — not this catch.
      }
    } finally {
      this.afterRefresh?.();
    }
  }

  /**
   * Poison this instance once its own last successful renewal is older than `selfExpiryMs` — a
   * threshold kept strictly below `leaseTimeoutMs`, so this always fires (and this instance stops
   * acting) before another opener could legitimately treat the lease as expired and take the root
   * over. Called on every heartbeat tick (twice — see {@link refresh}) and exposed for a caller to
   * also run before every persist, since a stall delays both the timer and any queued operation
   * equally, and whichever the event loop resumes first must still catch it.
   */
  public checkSelfExpiry(): void {
    if (this.released) return;
    const age = Date.now() - this.lastSuccessfulRefreshAt;
    if (age >= this.selfExpiryMs) {
      this.handleOwnershipLost(
        `this instance has not successfully renewed its own lease in ${String(age)}ms, at or past its ${String(this.selfExpiryMs)}ms self-expiry threshold (kept below the ${String(this.leaseTimeoutMs)}ms lease timeout so it stops before another opener may take the root over)`,
      );
    }
  }

  private handleOwnershipLost(reason: string): void {
    if (this.released) return;
    this.released = true;
    this.stopHeartbeat();
    this.onOwnershipLost?.(reason);
  }

  /**
   * Called after this instance has stopped acting (ownership lost, self-expired, or never acquired)
   * to check whether it may resume: if the lock still names THIS exact acquisition, nothing ever
   * actually took over — resume as the same owner. Otherwise this behaves like a fresh `acquire()`
   * (including guarded takeover of a now-stale lock) using this instance's identity: a caller that
   * regains ownership this way keeps its original token. Returns `true` iff this instance owns the
   * root when it returns; `false` leaves it exactly as poisoned as before (a live, different owner
   * still holds the root).
   */
  public async tryRecover(): Promise<boolean> {
    let raw: string;
    try {
      raw = await readFileAsync(this.lockFilePath, 'utf8');
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'ENOENT') return false; // ambiguous; stay refused
      const created = await this.tryCreate();
      if (created) this.startHeartbeat();
      return created;
    }

    const record = parseLockRecord(raw);
    if (record && this.isOurs(record)) {
      // Nobody ever took over — resume as the same owner, treating this observation itself as a
      // fresh renewal baseline.
      this.released = false;
      this.lastSuccessfulRefreshAt = Date.now();
      liveLocks.add(this);
      ensureProcessExitHandlerRegistered();
      this.startHeartbeat();
      return true;
    }

    const inspection = await this.inspectExistingLock();
    if (!inspection.stale) return false; // a live, different owner — stays permanently lost
    const tookOver = await this.attemptGuardedTakeover(inspection.observedToken);
    if (tookOver) this.startHeartbeat();
    return tookOver;
  }

  public async release(): Promise<void> {
    if (this.released) {
      liveLocks.delete(this);
      return;
    }
    this.released = true;
    this.stopHeartbeat();
    liveLocks.delete(this);
    try {
      const raw = await readFileAsync(this.lockFilePath, 'utf8');
      const record = parseLockRecord(raw);
      if (record && this.isOurs(record)) {
        await unlinkIgnoringMissing(this.lockFilePath);
      }
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return;
      // Best-effort: releasing must not throw and mask the caller's own close()/dispose path.
    }
  }

  /** Synchronous, best-effort cleanup run from the shared process `exit` handler. Never throws. */
  public cleanupOnExitSync(): void {
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
  }
}
