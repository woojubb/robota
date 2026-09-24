import { randomUUID } from 'node:crypto';
import { linkSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
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

/**
 * Upper bound on the age past which an unheld takeover guard is presumed abandoned — see
 * `guardStaleTimeoutMs` (an instance field, since it also depends on `leaseTimeoutMs`) for the actual
 * threshold used. Deliberately its own short constant, independent of the (typically much longer) lease
 * timeout: a guard is only ever held for the duration of one guarded acquisition attempt — a handful of
 * small file operations — never for as long as a live owner's lease. Reusing the full lease timeout here
 * once meant a leftover guard (its holder crashed before releasing it) could wedge every `acquire()` on
 * the root for as long as that lease timeout; this cap is instead sized for the slowest a single guarded
 * attempt should plausibly take (a slow disk, a GC pause), with generous margin.
 */
const GUARD_STALE_TIMEOUT_CAP_MS = 5_000;
/** Base delay between contested-guard retries, so a run of them is a slow poll rather than a tight
 *  spin. Jittered (see the call site) rather than fixed: several racers all sleeping the exact same
 *  fixed interval wake in lockstep on every cycle, which can let bad luck alone make the SAME racer
 *  keep losing the guard race to whichever other racer's promise happens to be scheduled microseconds
 *  earlier, cycle after cycle — jitter breaks that synchronization. */
const ACQUIRE_RETRY_DELAY_MS = 20;
/** How many contested retries `acquireInternal` makes with NO deliberate delay before it starts
 *  sleeping between them — see the call site for why immediate retries are both safe and important for
 *  a caller with a short `leaseTimeoutMs`. */
const FAST_RETRY_ATTEMPTS = 200;
/** A hard cap on retry iterations, independent of the time budget below — a pure safety valve against
 *  a pathological spin should the wall clock itself misbehave (e.g. moves backwards). Sized generously
 *  so it is never the thing that cuts off a legitimate wait in practice. */
const MAX_ACQUIRE_ATTEMPTS = 1_000;

/** Deliberately NOT `.unref()`'d — unlike the heartbeat's long-lived interval (which must not keep an
 *  otherwise-idle process alive), this backs an in-progress `acquire()` call: the caller is actively
 *  awaiting it, so the process must stay alive to deliver that result, even if every other handle in the
 *  process happens to be unref'd (e.g. no live heartbeats yet). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
   * occupies it, or because this instance self-expired. This is PERMANENT: the caller must stop
   * treating itself as the owner and, to use this root again, open a new instance (which goes
   * through ordinary acquisition — including taking over this one's now-abandoned lock once it is
   * genuinely stale).
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

interface IGuardRecord {
  pid: number;
  hostname: string;
  /** Identifies this specific guard acquisition, so a reclaim or release can confirm it is acting on
   *  the exact guard it observed rather than one that has since replaced it. */
  token: string;
  /** ISO timestamp the guard was created — used both to judge staleness (age-based, since a guard is
   *  never renewed the way the lock's lease is) and to name the current holder in a contention error. */
  createdAt: string;
}

function parseGuardRecord(raw: string): IGuardRecord | undefined {
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
    typeof (parsed as { createdAt?: unknown }).createdAt !== 'string'
  ) {
    return undefined;
  }
  return parsed as IGuardRecord;
}

interface IStaleInspection {
  stale: boolean;
  message: string;
  pid?: number;
  hostname?: string;
  /** The token this inspection judged — for a guarded takeover to confirm, at the moment it actually
   *  removes anything, that it is acting on the exact acquisition it judged stale and not a different
   *  one that has since replaced it. `undefined` when the lock had no parseable token to observe
   *  (already gone, or unreadable content). */
  observedToken?: string;
  /** The exact bytes observed, when the content was NOT a valid record (garbage/unreadable) but old
   *  enough to be presumed abandoned. Verifying removal against these exact bytes (there is no token
   *  to check) still avoids blindly deleting whatever now occupies the path. */
  observedRaw?: string;
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

/**
 * Renew `lockFilePath` to `newRecord`, but ONLY if, at the moment of the swap, it still names
 * `expectedToken` — and only by an EXCLUSIVE create of the new content, never a bare overwrite.
 *
 * A plain "read, confirm it's still ours, then overwrite" has a gap between the confirmation and the
 * write: a takeover landing in that gap would have its brand-new lock clobbered by this instance's own
 * stale renewal, which is exactly the double-owner outcome the whole lease/self-expiry design exists to
 * prevent. Renaming the current file aside first (as {@link verifiedRemove} does for removal) closes the
 * confirmation half of that gap; publishing the new content via exclusive `link()` rather than `rename`
 * closes the other half — if a different acquisition's `tryCreate()` already recreated the path in the
 * instant between this call's removal and its own publish, that `link()` fails with `EEXIST` instead of
 * silently overwriting it, and this call reports the renewal lost rather than having won it.
 *
 * Returns `true` on a successful, verified renewal, `false` when the lock no longer named this
 * acquisition or a different acquisition won the recreation race — either way, ownership must be
 * treated as lost.
 */
async function verifiedRenew(
  lockFilePath: string,
  expectedToken: string,
  newRecord: IOwnerLockRecord,
): Promise<boolean> {
  const asidePath = `${lockFilePath}.aside-${randomUUID()}`;
  try {
    await rename(lockFilePath, asidePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return false; // already gone
    throw error;
  }

  let raw: string | undefined;
  try {
    raw = await readFileAsync(asidePath, 'utf8');
  } catch {
    raw = undefined;
  }
  const stillOurs = raw !== undefined && parseLockRecord(raw)?.token === expectedToken;
  if (!stillOurs) {
    try {
      await link(asidePath, lockFilePath);
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;
      // Something else already occupies the path now — not ours to restore.
    }
    await unlinkIgnoringMissing(asidePath);
    return false;
  }
  await unlinkIgnoringMissing(asidePath);

  const temporaryFilePath = `${lockFilePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryFilePath, JSON.stringify(newRecord));
    try {
      await link(temporaryFilePath, lockFilePath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') return false; // lost the recreation race
      throw error;
    }
  } finally {
    await unlinkIgnoringMissing(temporaryFilePath);
  }
  return true;
}

/**
 * Destructively remove `targetPath`, but ONLY if, at the moment of removal, its content still
 * satisfies `matches` — never based on an earlier, separate check.
 *
 * A plain "check content, then unlink" is a TOCTOU race: whatever currently occupies `targetPath` by
 * the time the unlink actually runs might not be what an earlier read saw. `rename(targetPath, aside)`
 * is the atomic step that closes that gap — it unconditionally captures a stable snapshot of whatever
 * is CURRENTLY there (there is no way to rename "only if" content matches; the kernel does not offer
 * that), which is why the content is verified AFTER the rename rather than before: only then is it
 * certain that no third party can have swapped the content out from under this check.
 *
 * If the aside copy's content does not match, this call just displaced someone else's live file —
 * `link(aside, targetPath)` puts it back (a fresh inode is fine: whoever holds it never re-reads it
 * mid-use, only creates and eventually unlinks it by path) — and the caller must treat this as a lost
 * race, not as having removed the right thing.
 *
 * Returns `'removed'` (content matched; gone for good), `'mismatch'` (wrong occupant; restored, or the
 * restore itself lost a race — either way this call removed nothing that mattered), or `'gone'`
 * (nothing was at `targetPath` to begin with).
 */
async function verifiedRemove(
  targetPath: string,
  matches: (raw: string) => boolean,
): Promise<'removed' | 'mismatch' | 'gone'> {
  const asidePath = `${targetPath}.aside-${randomUUID()}`;
  try {
    await rename(targetPath, asidePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return 'gone';
    throw error;
  }

  let raw: string | undefined;
  try {
    raw = await readFileAsync(asidePath, 'utf8');
  } catch {
    raw = undefined;
  }

  if (raw !== undefined && matches(raw)) {
    await unlinkIgnoringMissing(asidePath);
    return 'removed';
  }

  // Wrong occupant: restore it under its original name (its rightful holder is not expecting it to
  // have moved) rather than silently discarding it.
  try {
    await link(asidePath, targetPath);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;
    // Someone else has already recreated `targetPath` in the meantime. The holder this call displaced
    // will notice its own token-verified step (its release, or its own takeover's recheck) no longer
    // matches and back off there instead — this call does not need to reconcile that.
  }
  await unlinkIgnoringMissing(asidePath);
  return 'mismatch';
}

function unlinkIgnoringMissingSync(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return;
    throw error;
  }
}

/** Synchronous counterpart of {@link verifiedRemove}, for the process `exit` handler — which must run
 *  synchronously and so cannot use the promise-based fs API. Same rename-aside-then-verify shape, same
 *  guarantee: never removes, and never leaves removed, anything but the exact content `matches` names. */
function verifiedRemoveSync(
  targetPath: string,
  matches: (raw: string) => boolean,
): 'removed' | 'mismatch' | 'gone' {
  const asidePath = `${targetPath}.aside-${randomUUID()}`;
  try {
    renameSync(targetPath, asidePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return 'gone';
    throw error;
  }

  let raw: string | undefined;
  try {
    raw = readFileSync(asidePath, 'utf8');
  } catch {
    raw = undefined;
  }

  if (raw !== undefined && matches(raw)) {
    unlinkIgnoringMissingSync(asidePath);
    return 'removed';
  }

  try {
    linkSync(asidePath, targetPath);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;
  }
  unlinkIgnoringMissingSync(asidePath);
  return 'mismatch';
}

// A SINGLE module-level `exit` listener, rather than one per lock: many `FileStoragePort`s can be
// acquired and released over a process's lifetime (tests do this heavily), and a per-instance
// `process.once('exit', ...)` would otherwise accumulate one listener per acquisition. `liveLocks`
// holds every lock this process has ever successfully created. Each entry's own `isOurs()` check on
// exit means an entry that has since lost its lease to another owner is a harmless no-op here, so
// nothing needs to actively prune the set on ownership loss — only an explicit `release()` removes an
// entry, since that is the only case a cleanup has already run.
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
 * EVERY ACQUISITION ATTEMPT IS SERIALIZED by a second, short-lived exclusive file (the "takeover
 * guard") — not only the stale-lock-removal step, but also the fast path where the lock file does not
 * exist at all: only the guard's single current holder may ever create or remove the lock file, so no
 * two racers' creates can ever land on the same emptied path. Every destructive step under the guard —
 * reclaiming an abandoned guard, and removing a lock judged stale — is further TOKEN-VERIFIED via
 * {@link verifiedRemove} rather than a bare check-then-unlink: a bare `unlink` acts on whatever is
 * CURRENTLY at the path, not on the specific file a caller earlier judged stale, so removal itself could
 * still destroy something that has since legitimately replaced it (a live owner's fresh lease, or
 * another guard generation). `verifiedRemove` closes that gap by renaming (atomic, unconditional) before
 * ever inspecting content, so the content check that follows is provably about the exact file just
 * removed from the path, not a snapshot that may already be stale itself.
 *
 * A guard is presumed abandoned once it is older than its own short staleness threshold — deliberately
 * NOT the (typically much longer) lease timeout, since a guard is only ever held for the duration of one
 * guarded attempt, never as long as a live owner's lease — or once it names a same-host process that is
 * no longer alive. It is reclaimed the same verified way: its current token is read, and only a
 * `verifiedRemove` that confirms that SAME token is actually gone counts as a successful reclaim — if
 * something else already holds the guard under a different token by the time the removal runs, this
 * call restores it and reports no reclaim, rather than assuming its earlier read was still current.
 * `acquire()` retries a contested guard with a bounded, backed-off wait rather than a small fixed number
 * of immediate attempts, so a genuinely abandoned guard's short staleness window is reliably waited out
 * within the SAME `acquire()` call instead of the caller needing to retry.
 *
 * RESIDUAL RISKS, both bounded and never a double-owner outcome:
 * - a taker that stalls (GC pause, scheduler starvation) for longer than the guard's own staleness
 *   threshold WHILE holding it makes its own guard reclaimable by someone else, who may then complete an
 *   entire takeover before the stalled taker resumes. This is still safe: the stalled taker's own
 *   final step — creating the lock file via the same exclusive `link()` every acquisition uses —
 *   fails with `EEXIST` against whatever the other taker already created, so at most one of them ever
 *   ends up believing it owns the root. The guard bounds how long a takeover attempt may go unnoticed
 *   if abandoned; it is not itself where the safety guarantee lives — the lock file's own exclusive
 *   creation is;
 * - a guard `release()`/reclaim can, in a narrow enough race, resurrect a guard that its rightful
 *   holder had already believed it removed: holder H's own release finds the path already emptied by
 *   a third party's concurrent reclaim of what H thought was still its own guard, and that third
 *   party's mismatch-handling restore then puts H's (now orphaned) guard content back. Nobody owns
 *   cleaning that copy up, but its `link()`-refreshed mtime means it is not immediately reclaimable
 *   either — it self-heals once its age exceeds the guard's staleness threshold, the same as any other
 *   abandoned guard. Observed in stress testing at a low single-digit percentage of rounds under
 *   five-way-or-more contention on one root; it delays, but never breaks, a later takeover of that
 *   specific root, and the delay is bounded by the same short threshold, not by the lease timeout.
 *
 * The live owner renews its lease on an unref'd interval. Each renewal first checks that the lock
 * file still names THIS acquisition (by a random per-acquisition token, not just pid/hostname, since
 * a later acquisition in the same process can share both) — if it does not, another owner has taken
 * over (this owner's lease lapsed during a long stall) and `onOwnershipLost` fires so the caller can
 * poison itself rather than silently continuing to write as an unaccounted-for second owner. The renewal
 * write itself is token-verified via {@link verifiedRenew}, not a bare overwrite: a takeover landing in
 * the gap between this check and an unconditional write could otherwise have this instance's own stale
 * renewal clobber the new owner's freshly created lock.
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
 * Losing the lock — to a real takeover or to self-expiry — is PERMANENT: the only way to use this root
 * again is to open a new instance.
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
  /** {@link GUARD_STALE_TIMEOUT_CAP_MS}, but never more than this instance's OWN `leaseTimeoutMs`: a
   *  caller configuring a short lease (fast failover) must not have guard contention take LONGER to
   *  resolve than that lease's own staleness window — a delayed contender who finally gets the guard
   *  after outlasting a longer, fixed guard threshold could otherwise see an otherwise-healthy, just
   *  created lock as stale simply because ITS OWN wait took longer than the lease timeout it is bound
   *  by, legitimately but spuriously taking over a lock nobody actually abandoned. */
  private readonly guardStaleTimeoutMs: number;
  /** Wall-clock budget `acquireInternal` waits out a contested guard, derived from
   *  `guardStaleTimeoutMs` with margin for the reclaim itself — see there for why it is capped at all. */
  private readonly acquireWaitBudgetMs: number;
  private readonly onOwnershipLost: ((reason: string) => void) | undefined;
  private readonly afterRefresh: (() => void) | undefined;
  private readonly guardPath: string;
  private refreshTimer: NodeJS.Timeout | undefined;
  /** Epoch ms of this instance's own last SUCCESSFUL lease renewal; the initial acquisition counts. */
  private lastSuccessfulRefreshAt = 0;
  /** Set while `acquireGuard()` holds the takeover guard; identifies which acquisition of it this is,
   *  so `releaseGuard()` only removes the guard if it still holds exactly that acquisition. */
  private currentGuardToken: string | undefined;
  /** The last OTHER acquisition's guard this instance observed still fresh (not yet reclaimable) while
   *  contested — used only to name the current holder in the error thrown if the wait budget runs out. */
  private lastGuardHolder: { pid: number; hostname: string; createdAt: string } | undefined;

  private constructor(
    private readonly lockFilePath: string,
    options: IFileStoreOwnerLockOptions,
  ) {
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_LOCK_REFRESH_INTERVAL_MS;
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? DEFAULT_LOCK_LEASE_TIMEOUT_MS;
    this.selfExpiryMs =
      options.selfExpiryMs ?? computeSelfExpiryMs(this.refreshIntervalMs, this.leaseTimeoutMs);
    this.guardStaleTimeoutMs = Math.min(GUARD_STALE_TIMEOUT_CAP_MS, this.leaseTimeoutMs);
    this.acquireWaitBudgetMs = this.guardStaleTimeoutMs + 2_000;
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
   * Returns `true` on success (acquired outright, or won a guarded takeover), or the conflict to
   * throw when every attempt was refused or exhausted without ever owning the root.
   *
   * The first {@link FAST_RETRY_ATTEMPTS} contested retries have NO deliberate delay: real racers hold
   * the guard for microseconds (a handful of small file operations), so contention among them resolves
   * within a few immediate retries — and a caller with a short `leaseTimeoutMs` (fast failover) is
   * relying on exactly that speed, which an unconditional sleep here would eat into for no benefit,
   * risking an otherwise-healthy just-acquired lock being seen as stale by a straggler that took longer
   * to get its turn only because THIS loop made it wait. Only once contention has outlasted that many
   * immediate retries — meaning it is very unlikely to be ordinary live contention — does this fall back
   * to a small delay ({@link ACQUIRE_RETRY_DELAY_MS}, jittered) rather than spinning tightly, bounded by
   * wall-clock time (`acquireWaitBudgetMs`) rather than a fixed attempt count: a guard left behind by a
   * crashed taker only becomes reclaimable once it ages past `guardStaleTimeoutMs`, and a small fixed
   * attempt count could exhaust itself and report "contested" well before that. `MAX_ACQUIRE_ATTEMPTS`
   * remains as a hard iteration cap purely as a safety valve.
   */
  private async acquireInternal(): Promise<FileStoreOwnerConflictError | true> {
    const deadline = Date.now() + this.acquireWaitBudgetMs;
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
      const outcome = await this.attemptOneAcquisition();
      if (outcome === true) {
        this.startHeartbeat();
        return true;
      }
      if (outcome !== false) {
        return outcome;
      }
      // Contested — the guard itself, or the lock changed underneath this attempt — retry the whole
      // detect-and-take cycle, unless the wait budget is spent.
      if (Date.now() >= deadline) break;
      if (attempt >= FAST_RETRY_ATTEMPTS) {
        await sleep(Math.random() * ACQUIRE_RETRY_DELAY_MS * 4);
      }
    }
    return new FileStoreOwnerConflictError(this.describeGuardContention());
  }

  /** The message for a contended-guard timeout — names the current holder when it was ever observed
   *  (a valid, parseable guard record), or falls back to a generic message when it was not (unreadable
   *  content, or the guard kept changing hands without this instance ever reading a valid record). */
  private describeGuardContention(): string {
    const holder = this.lastGuardHolder;
    if (holder) {
      return (
        `file store owner lock at ${this.lockFilePath} is contested: its takeover guard has been held ` +
        `by pid ${String(holder.pid)} on host ${holder.hostname} since ${holder.createdAt}, past the ` +
        `${String(this.acquireWaitBudgetMs)}ms this instance waited for it to either finish or become ` +
        `reclaimable as abandoned`
      );
    }
    return `file store owner lock at ${this.lockFilePath} is contested by concurrent takeover attempts`;
  }

  /**
   * One full attempt, entirely serialized by the takeover guard — including the FAST path where the
   * lock file does not exist at all: an absent path is indistinguishable, to a bystander racer's plain
   * exclusive create, from a root nobody has ever raced for, so ONLY the guard's single current holder
   * may ever create or remove the lock file — otherwise two racers' creates could land on the same
   * emptied path (one racer's guard-protected removal of a stale lock, followed by its own recreation of
   * a fresh one, briefly leaves the path absent).
   *
   * Returns `true` on success, the conflict to throw when the current occupant is a live owner, or
   * `false` when this attempt was contested and the caller should retry the whole cycle.
   */
  private async attemptOneAcquisition(): Promise<boolean | FileStoreOwnerConflictError> {
    if (!(await this.acquireGuard())) return false;
    try {
      if (await this.tryCreate()) return true;

      const inspection = await this.inspectExistingLock();
      if (!inspection.stale) {
        return new FileStoreOwnerConflictError(
          inspection.message,
          inspection.pid,
          inspection.hostname,
        );
      }

      if (inspection.observedToken !== undefined) {
        const removal = await verifiedRemove(
          this.lockFilePath,
          (raw) => parseLockRecord(raw)?.token === inspection.observedToken,
        );
        if (removal === 'mismatch') return false;
      } else if (inspection.observedRaw !== undefined) {
        const removal = await verifiedRemove(this.lockFilePath, (raw) => raw === inspection.observedRaw);
        if (removal === 'mismatch') return false;
      }
      // Nobody else can be touching this lock file while we hold the guard — every create and every
      // removal now happens only under it — so this create either wins outright or fails because the
      // path is, impossibly, still occupied by something this inspection did not see; either way it is
      // safe to just report the outcome.
      return await this.tryCreate();
    } finally {
      await this.releaseGuard();
    }
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
    liveLocks.add(this);
    ensureProcessExitHandlerRegistered();
    return true;
  }

  private async acquireGuard(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = randomUUID();
      if (await this.tryCreateGuard(token)) {
        this.currentGuardToken = token;
        return true;
      }
      const reclaimed = await this.reclaimStaleGuardIfAbandoned();
      if (!reclaimed) return false;
      // The stale guard is gone (or was already gone) — retry the exclusive create once more.
    }
    return false;
  }

  private async tryCreateGuard(token: string): Promise<boolean> {
    const record: IGuardRecord = {
      pid: process.pid,
      hostname: os.hostname(),
      token,
      createdAt: new Date().toISOString(),
    };
    try {
      const handle = await open(this.guardPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify(record));
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') return false;
      throw error;
    }
  }

  private async releaseGuard(): Promise<void> {
    const token = this.currentGuardToken;
    this.currentGuardToken = undefined;
    if (token === undefined) return;
    try {
      await verifiedRemove(this.guardPath, (raw) => parseGuardRecord(raw)?.token === token);
    } catch {
      // Best-effort: releasing must not throw and mask the caller's own path (the takeover's own
      // `finally`, or eventually this instance's `release()`/exit cleanup).
    }
  }

  /**
   * A guard is presumed abandoned (its holder crashed mid-acquisition, never reaching its own
   * `releaseGuard()`) once it is older than `guardStaleTimeoutMs` — deliberately a short,
   * fixed threshold, since a guard is only ever meant to be held for the duration of one guarded
   * attempt, never as long as a live owner's lease — OR once it names a process on THIS host that is no
   * longer alive, the same same-host-dead-pid fast path the lock itself uses. Its current record is
   * read first, and only a `verifiedRemove` confirming that SAME token counts as a genuine reclaim — a
   * bare "check age, then unlink" would act on whatever is at the path by the time the unlink runs,
   * which can be a brand-new guard a different taker created after the old one was legitimately
   * released. When the guard is still fresh and genuinely contested, its holder is recorded so a caller
   * that eventually gives up can name it rather than reporting generic contention.
   */
  private async reclaimStaleGuardIfAbandoned(): Promise<boolean> {
    let raw: string;
    try {
      raw = await readFileAsync(this.guardPath, 'utf8');
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return true; // already gone; retry create
      return false; // unreadable; be conservative rather than guess
    }

    const record = parseGuardRecord(raw);
    if (record) {
      const createdAtMs = Date.parse(record.createdAt);
      const ageMs = Number.isNaN(createdAtMs) ? undefined : Date.now() - createdAtMs;
      const staleByAge = ageMs !== undefined && ageMs > this.guardStaleTimeoutMs;
      const sameHostDead = record.hostname === os.hostname() && !isProcessAlive(record.pid);
      if (!staleByAge && !sameHostDead) {
        this.lastGuardHolder = { pid: record.pid, hostname: record.hostname, createdAt: record.createdAt };
        return false; // still fresh, and its holder (on a host we can check) is alive; genuinely contested
      }
      const outcome = await verifiedRemove(this.guardPath, (r) => parseGuardRecord(r)?.token === record.token);
      return outcome !== 'mismatch'; // 'removed' or 'gone' both leave the path free to retry create
    }

    // Unparseable content (a hand-placed file, or something from a different version of this code):
    // no token or timestamp to reason about, so fall back to the guard path's own mtime, the same
    // defence-in-depth age check the lock's own unreadable-content path uses.
    const mtimeMs = await statMtimeMs(this.guardPath).catch(() => undefined);
    if (mtimeMs === undefined) return true; // gone since the read above; retry create
    if (Date.now() - mtimeMs <= this.guardStaleTimeoutMs) return false; // still young; genuinely contested
    const outcome = await verifiedRemove(this.guardPath, (r) => r === raw);
    return outcome !== 'mismatch';
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
      // This code's own creation path cannot produce unreadable content (always a full write to a
      // temp file, published only by an atomic `link`) — this path exists for content THIS code never
      // wrote: disk corruption, a hand-placed file, or a lock left by a different version of this
      // format. Age is the only signal available for those: young is left alone, old is presumed
      // abandoned.
      const mtimeMs = await statMtimeMs(this.lockFilePath).catch(() => undefined);
      const abandoned = mtimeMs !== undefined && Date.now() - mtimeMs > this.leaseTimeoutMs;
      return abandoned
        ? {
            stale: true,
            observedRaw: raw,
            message: `file store owner lock at ${this.lockFilePath} has unreadable contents older than the lease timeout`,
          }
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
        const renewed = await verifiedRenew(this.lockFilePath, this.token, { ...record, refreshedAt });
        if (renewed) {
          this.lastSuccessfulRefreshAt = refreshedAt;
        } else {
          this.handleOwnershipLost('the storage root is now owned by a different instance');
        }
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
    // Prune eagerly rather than leaving a poisoned entry for `liveLocks` to skip forever: a
    // long-running process that opens and loses many short-lived locks over its lifetime would
    // otherwise accumulate one dead entry per loss, never freed until the process itself exits.
    liveLocks.delete(this);
    this.onOwnershipLost?.(reason);
  }

  /**
   * Release this acquisition. Idempotent, and safe even if ownership was already lost (self-expiry or
   * a takeover) rather than explicitly released: the lock file is removed only if it STILL names this
   * exact acquisition, so releasing after a real takeover correctly does nothing to the new owner's
   * lock, while releasing after a false-alarm self-expiry (nobody ever actually took over) still
   * cleans up promptly instead of leaving the root wedged until the lease ages out on its own.
   */
  public async release(): Promise<void> {
    this.released = true;
    this.stopHeartbeat();
    liveLocks.delete(this);
    try {
      // Token-verified, not a plain "read, confirm, then unlink": a bare check-then-act here could
      // delete a NEW owner's freshly created lock if that takeover lands between the read and the
      // unlink — e.g. a late `release()` racing a self-expired instance's own lease being taken over.
      await verifiedRemove(this.lockFilePath, (raw) => parseLockRecord(raw)?.token === this.token);
    } catch {
      // Best-effort: releasing must not throw and mask the caller's own close()/dispose path.
    }
  }

  /** Synchronous, best-effort cleanup run from the shared process `exit` handler. Never throws. Uses
   *  the same token-verified rename-aside-then-check shape as `release()`, via sync fs calls since an
   *  `exit` handler cannot await. */
  public cleanupOnExitSync(): void {
    try {
      verifiedRemoveSync(this.lockFilePath, (raw) => parseLockRecord(raw)?.token === this.token);
    } catch {
      // Best-effort only: a missing file, a race with another cleanup, or a read error here must
      // never turn process shutdown into a crash. Also never fires on SIGKILL or a hard crash — the
      // heartbeat lease timeout is what reclaims the root in those cases, not this handler.
    }
  }
}
