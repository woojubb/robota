import { randomUUID } from 'node:crypto';
import {
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { link, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Exclusive ownership of one file-storage root, as a sequence of numbered epoch files.
 *
 * Every acquisition creates the file `.owner.<n>` for the next epoch `n`, and ONLY by exclusive
 * creation (a fully written temp file `link()`ed into place — `EEXIST` means another acquirer won
 * that epoch). So exactly one acquisition ever holds any given epoch. An epoch file is never deleted
 * while it is the highest one and only its own holder ever rewrites it (heartbeat renewal and the
 * release mark, both an atomic `rename` of a temp file over it), which makes the highest existing
 * epoch number monotonically non-decreasing. Ownership is therefore a local question:
 *
 *   an instance owns the root iff its own epoch file still carries its token and no higher epoch
 *   exists.
 *
 * Two instances cannot both satisfy that: both would have to hold the highest epoch, which only one
 * of them created. A newer epoch is only created on top of one judged not live — released by its
 * holder, holder on this host no longer running, `refreshedAt` older than the lease timeout the
 * holder recorded, or an unreadable file older than the reader's lease timeout — and a holder stops
 * acting (self-expires) strictly before its own recorded lease can look stale to anyone else.
 *
 * Residual assumptions: clocks on hosts sharing a root are roughly synchronized (lease age compares
 * the reader's clock with the holder's), and a holder never stalls between its ownership check and
 * the write it guards for longer than the self-expiry margin below the lease timeout.
 */

export const DEFAULT_LOCK_REFRESH_INTERVAL_MS = 5_000;
export const DEFAULT_LOCK_LEASE_TIMEOUT_MS = 30_000;

const EPOCH_FILE_PATTERN = /^\.owner\.([1-9]\d*)$/;
const TEMP_FILE_PREFIX = '.owner-tmp.';
const MAX_ACQUIRE_ATTEMPTS = 50;

export interface IFileStoreOwnerLockOptions {
  /** How often the live owner renews its epoch file. Defaults to {@link DEFAULT_LOCK_REFRESH_INTERVAL_MS}. */
  refreshIntervalMs?: number;
  /** Age past which an epoch is stale regardless of host or pid. Defaults to {@link DEFAULT_LOCK_LEASE_TIMEOUT_MS}. */
  leaseTimeoutMs?: number;
  /** Age of this instance's own last successful renewal past which it stops acting as owner.
   *  Defaults to `leaseTimeoutMs - 2 * refreshIntervalMs`; must not exceed it. */
  selfExpiryMs?: number;
  /** Called once when this instance permanently stops owning the root (displaced or self-expired). */
  onOwnershipLost?: (reason: string) => void;
  /** Test hook: called at the end of every heartbeat renewal, whatever its outcome. */
  afterRefresh?: () => void;
}

export interface IOwnerLockTiming {
  refreshIntervalMs: number;
  leaseTimeoutMs: number;
  selfExpiryMs: number;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Resolve and validate lease timing. Throws `RangeError` for a configuration whose self-expiry
 *  could not precede the lease timeout by at least two refresh intervals. */
export function resolveOwnerLockTiming(options: IFileStoreOwnerLockOptions = {}): IOwnerLockTiming {
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_LOCK_REFRESH_INTERVAL_MS;
  const leaseTimeoutMs = options.leaseTimeoutMs ?? DEFAULT_LOCK_LEASE_TIMEOUT_MS;
  if (!isPositiveFinite(refreshIntervalMs) || !isPositiveFinite(leaseTimeoutMs)) {
    throw new RangeError(
      'owner lock refreshIntervalMs and leaseTimeoutMs must be positive finite numbers',
    );
  }
  if (refreshIntervalMs * 3 > leaseTimeoutMs) {
    throw new RangeError(
      `owner lock refreshIntervalMs (${String(refreshIntervalMs)}) must be at most a third of leaseTimeoutMs (${String(leaseTimeoutMs)})`,
    );
  }
  const maxSelfExpiryMs = leaseTimeoutMs - 2 * refreshIntervalMs;
  const selfExpiryMs = options.selfExpiryMs ?? maxSelfExpiryMs;
  if (!isPositiveFinite(selfExpiryMs) || selfExpiryMs > maxSelfExpiryMs) {
    throw new RangeError(
      `owner lock selfExpiryMs (${String(selfExpiryMs)}) must be positive and at most leaseTimeoutMs - 2 * refreshIntervalMs (${String(maxSelfExpiryMs)})`,
    );
  }
  return { refreshIntervalMs, leaseTimeoutMs, selfExpiryMs };
}

/** Thrown when a storage root is owned by another live instance, or this instance lost ownership. */
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

interface IEpochRecord {
  token: string;
  pid: number;
  hostname: string;
  /** Machine boot and PID namespace of `pid`; empty when unknown. See {@link currentHostIdentity}. */
  hostIdentity: string;
  acquiredAt: string;
  /** Epoch ms of the holder's last renewal — the authoritative lease clock. */
  refreshedAt: number;
  /** The holder's own lease timeout; its self-expiry is derived from it, so readers judge by it. */
  leaseTimeoutMs: number;
  released: boolean;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function parseRecord(raw: string): IEpochRecord | undefined {
  try {
    const value = JSON.parse(raw) as Partial<IEpochRecord> | null;
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof value.token === 'string' &&
      typeof value.pid === 'number' &&
      typeof value.hostname === 'string' &&
      typeof value.hostIdentity === 'string' &&
      typeof value.acquiredAt === 'string' &&
      typeof value.refreshedAt === 'number' &&
      typeof value.leaseTimeoutMs === 'number' &&
      typeof value.released === 'boolean'
    ) {
      return value as IEpochRecord;
    }
  } catch {
    // fall through
  }
  return undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but may not be signalled.
    return !isErrno(error, 'ESRCH');
  }
}

let hostIdentity: string | undefined;

/**
 * Identifies the PID space a recorded pid belongs to: hostname, boot, and (on Linux) PID namespace.
 * The same-host dead-pid shortcut applies only when this matches exactly — a hostname alone can be
 * shared by containers with separate PID namespaces or by cloned machines, where a live holder's pid
 * looks dead. Empty when any component is unavailable, which disables the shortcut (the lease still
 * applies).
 */
export function currentHostIdentity(): string {
  if (hostIdentity !== undefined) return hostIdentity;
  try {
    if (process.platform === 'linux') {
      const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      const pidNamespace = statSync('/proc/self/ns/pid').ino;
      hostIdentity = bootId ? `${os.hostname()}|boot:${bootId}|pidns:${String(pidNamespace)}` : '';
    } else {
      // No PID namespaces here; the boot second (uptime is whole seconds) distinguishes reboots and
      // cloned machines. A wall-clock step between two processes' readings only yields a mismatch,
      // which falls back to the lease.
      const bootSecond = Math.floor((Date.now() - os.uptime() * 1_000) / 1_000);
      hostIdentity = `${os.hostname()}|boot:${String(bootSecond)}|pidns:host`;
    }
  } catch {
    hostIdentity = '';
  }
  return hostIdentity;
}

function epochNumbers(names: string[]): number[] {
  const epochs: number[] = [];
  for (const name of names) {
    const match = EPOCH_FILE_PATTERN.exec(name);
    const epoch = Number(match?.[1]);
    if (Number.isSafeInteger(epoch)) epochs.push(epoch);
  }
  return epochs.sort((a, b) => a - b);
}

function describeHolder(record: IEpochRecord): string {
  return `pid ${String(record.pid)} on host ${record.hostname} since ${record.acquiredAt}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  await unlink(filePath).catch((error: unknown) => {
    if (!isErrno(error, 'ENOENT')) throw error;
  });
}

// One process-level exit handler for every lock this process holds; `exit` handlers are synchronous.
const heldLocks = new Set<FileStoreOwnerLock>();
let exitHandlerRegistered = false;

function registerForExit(lock: FileStoreOwnerLock): void {
  heldLocks.add(lock);
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;
  process.once('exit', () => {
    for (const held of heldLocks) held.releaseOnExitSync();
  });
}

type TOwnershipVerdict = { owned: true } | { owned: false; reason: string };

export class FileStoreOwnerLock {
  private readonly token = randomUUID();
  private readonly timing: IOwnerLockTiming;
  private epoch = 0;
  private record: IEpochRecord | undefined;
  /** Epoch ms of the `refreshedAt` this instance last wrote successfully. */
  private lastRenewedAt = 0;
  private lost = false;
  private stopped = false;
  private heartbeat: NodeJS.Timeout | undefined;
  private renewal: Promise<void> | undefined;

  private constructor(
    private readonly root: string,
    private readonly options: IFileStoreOwnerLockOptions,
  ) {
    this.timing = resolveOwnerLockTiming(options);
  }

  public static async acquire(
    storageRootPath: string,
    options: IFileStoreOwnerLockOptions = {},
  ): Promise<FileStoreOwnerLock> {
    const lock = new FileStoreOwnerLock(storageRootPath, options);
    await lock.acquireEpoch();
    return lock;
  }

  private epochPath(epoch: number): string {
    return path.join(this.root, `.owner.${String(epoch)}`);
  }

  private tempPath(): string {
    return path.join(this.root, `${TEMP_FILE_PREFIX}${randomUUID()}`);
  }

  private async listEpochs(): Promise<number[]> {
    return epochNumbers(await readdir(this.root));
  }

  private async readRecord(epoch: number): Promise<IEpochRecord | undefined> {
    return parseRecord(await readFile(this.epochPath(epoch), 'utf8'));
  }

  /** Returns why `epoch` still blocks acquisition, or `undefined` when it may be superseded. */
  private async blockingHolder(epoch: number): Promise<FileStoreOwnerConflictError | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.epochPath(epoch), 'utf8');
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return undefined;
      throw error;
    }
    const record = parseRecord(raw);
    if (!record) {
      const { mtimeMs } = await stat(this.epochPath(epoch));
      if (Date.now() - mtimeMs > this.timing.leaseTimeoutMs) return undefined;
      return new FileStoreOwnerConflictError(
        `file store root ${this.root} has an unreadable owner epoch file ${path.basename(this.epochPath(epoch))} younger than the lease timeout`,
      );
    }
    if (record.released) return undefined;
    const identity = currentHostIdentity();
    if (identity !== '' && record.hostIdentity === identity && !isProcessAlive(record.pid)) {
      return undefined;
    }
    if (Date.now() - record.refreshedAt > record.leaseTimeoutMs) return undefined;
    return new FileStoreOwnerConflictError(
      `file store root ${this.root} is already owned by ${describeHolder(record)}`,
      record.pid,
      record.hostname,
    );
  }

  /** Exclusively create `epoch` holding `record`; `false` when another acquirer created it first. */
  private async tryCreate(epoch: number, record: IEpochRecord): Promise<boolean> {
    const temp = this.tempPath();
    await writeFile(temp, JSON.stringify(record), { flag: 'wx' });
    try {
      await link(temp, this.epochPath(epoch));
      return true;
    } catch (error) {
      if (isErrno(error, 'EEXIST')) return false;
      throw error;
    } finally {
      await unlinkIfPresent(temp).catch(() => undefined);
    }
  }

  private async acquireEpoch(): Promise<void> {
    let lastConflict: FileStoreOwnerConflictError | undefined;
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
      const top = (await this.listEpochs()).at(-1) ?? 0;
      if (top > 0) {
        const conflict = await this.blockingHolder(top);
        if (conflict) throw conflict;
      }
      const next = top + 1;
      const now = Date.now();
      const record: IEpochRecord = {
        token: this.token,
        pid: process.pid,
        hostname: os.hostname(),
        hostIdentity: currentHostIdentity(),
        acquiredAt: new Date(now).toISOString(),
        refreshedAt: now,
        leaseTimeoutMs: this.timing.leaseTimeoutMs,
        released: false,
      };
      if (await this.tryCreate(next, record)) {
        let highest: number;
        try {
          highest = (await this.listEpochs()).at(-1) ?? 0;
        } catch (error) {
          // Never leave a claimed but unowned epoch blocking the root for a full lease.
          this.epoch = next;
          this.record = record;
          await this.writeOwnRecord({ ...record, released: true }).catch(() => undefined);
          throw error;
        }
        if (highest === next) {
          this.epoch = next;
          this.record = record;
          this.lastRenewedAt = now;
          registerForExit(this);
          this.startHeartbeat();
          await this.removeSupersededFiles().catch(() => undefined);
          return;
        }
        // A higher epoch already exists (this create landed on a number vacated by cleanup), so this
        // file can never be the highest; drop it and re-evaluate.
        await unlinkIfPresent(this.epochPath(next));
      }
      lastConflict = new FileStoreOwnerConflictError(
        `file store root ${this.root} is contended: epoch ${String(next)} was taken by another acquirer`,
      );
      await sleep(Math.random() * 5);
    }
    throw (
      lastConflict ?? new FileStoreOwnerConflictError(`file store root ${this.root} is contended`)
    );
  }

  /** Delete epochs below the previous one, and temp files left by crashed writers. Only files that
   *  can no longer be the highest epoch are touched, so this never changes who owns the root. */
  private async removeSupersededFiles(): Promise<void> {
    const names = await readdir(this.root);
    for (const epoch of epochNumbers(names)) {
      if (epoch < this.epoch - 1) await unlinkIfPresent(this.epochPath(epoch));
    }
    for (const name of names) {
      if (!name.startsWith(TEMP_FILE_PREFIX)) continue;
      const filePath = path.join(this.root, name);
      const { mtimeMs } = await stat(filePath).catch(() => ({ mtimeMs: Date.now() }));
      if (Date.now() - mtimeMs > this.timing.leaseTimeoutMs) await unlinkIfPresent(filePath);
    }
  }

  private async checkOwnership(): Promise<TOwnershipVerdict> {
    const top = (await this.listEpochs()).at(-1) ?? 0;
    if (top > this.epoch) {
      const holder = await this.readRecord(top).catch(() => undefined);
      return {
        owned: false,
        reason: `the storage root was taken over by epoch ${String(top)}${holder ? ` (${describeHolder(holder)})` : ''}`,
      };
    }
    let own: IEpochRecord | undefined;
    try {
      own = await this.readRecord(this.epoch);
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error;
    }
    if (own?.token !== this.token) {
      return {
        owned: false,
        reason: `this instance's epoch file ${String(this.epoch)} no longer names it`,
      };
    }
    return { owned: true };
  }

  private checkSelfExpiry(): void {
    const age = Date.now() - this.lastRenewedAt;
    if (!this.lost && age > this.timing.selfExpiryMs) {
      this.markLost(
        `this instance has not renewed its lease for ${String(age)}ms, past its ${String(this.timing.selfExpiryMs)}ms self-expiry (lease timeout ${String(this.timing.leaseTimeoutMs)}ms)`,
      );
    }
  }

  private markLost(reason: string): void {
    if (this.lost) return;
    this.lost = true;
    this.stopHeartbeat();
    heldLocks.delete(this);
    this.options.onOwnershipLost?.(reason);
  }

  /**
   * Confirm this instance still owns the root; run before every storage operation. Ownership loss
   * (displaced or self-expired) is reported through `onOwnershipLost` and is permanent; an I/O
   * failure while checking rejects without deciding either way.
   */
  public async verifyOwnership(): Promise<boolean> {
    this.checkSelfExpiry();
    if (this.lost || this.stopped) return false;
    const verdict = await this.checkOwnership();
    if (!verdict.owned) this.markLost(verdict.reason);
    this.checkSelfExpiry();
    return !this.lost;
  }

  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      this.renewal ??= this.renew().finally(() => {
        this.renewal = undefined;
        this.options.afterRefresh?.();
      });
    }, this.timing.refreshIntervalMs);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  /** Rewrite this instance's own epoch file with a fresh `refreshedAt`, unless a higher epoch exists.
   *  Only this instance ever writes its epoch path, so the rename cannot overwrite anyone else's. */
  private async renew(): Promise<void> {
    try {
      if (!(await this.verifyOwnership()) || !this.record) return;
      const refreshedAt = Date.now();
      await this.writeOwnRecord({ ...this.record, refreshedAt });
      this.lastRenewedAt = refreshedAt;
    } catch {
      // Transient I/O failure: not proof of lost ownership. Self-expiry stops this instance if
      // renewals keep failing.
    }
  }

  private async writeOwnRecord(record: IEpochRecord): Promise<void> {
    if (this.stopped && !record.released) return;
    const temp = this.tempPath();
    try {
      await writeFile(temp, JSON.stringify(record), { flag: 'wx' });
      await rename(temp, this.epochPath(this.epoch));
      this.record = record;
    } finally {
      await unlinkIfPresent(temp).catch(() => undefined);
    }
  }

  /**
   * Mark this instance's epoch released so the next acquirer may take the root over at once.
   * Idempotent and never throws. The epoch file is marked, not deleted: deleting the highest epoch
   * would let a lower, displaced holder see itself as highest again. Marking a superseded epoch is
   * harmless, since only the highest epoch is ever judged.
   */
  public async release(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.stopHeartbeat();
    heldLocks.delete(this);
    await this.renewal;
    try {
      const own = await this.readRecord(this.epoch);
      if (own?.token === this.token && !own.released) {
        await this.writeOwnRecord({ ...own, released: true });
      }
    } catch {
      // Best effort: the lease timeout reclaims the root if this mark never lands.
    }
  }

  /** Synchronous best-effort release for the process `exit` handler. */
  public releaseOnExitSync(): void {
    if (this.stopped) return;
    this.stopped = true;
    const epochPath = this.epochPath(this.epoch);
    const temp = this.tempPath();
    try {
      if (epochNumbers(readdirSync(this.root)).some((epoch) => epoch > this.epoch)) return;
      const own = parseRecord(readFileSync(epochPath, 'utf8'));
      if (own?.token !== this.token) return;
      writeFileSync(temp, JSON.stringify({ ...own, released: true }), { flag: 'wx' });
      renameSync(temp, epochPath);
    } catch {
      try {
        unlinkSync(temp);
      } catch {
        // nothing to clean up
      }
    }
  }
}
