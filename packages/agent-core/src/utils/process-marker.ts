/**
 * Exclusive process markers kept as files in one owner-only directory: the Node implementation of
 * {@link IProcessMarkers}.
 *
 * A marker `<dir>/<name>.owner` holds its owner record (`process-owner-record.ts`) and, for a lent
 * marker, a lease digest. Whether it stands is decided by the same liveness rule process-scoped
 * directories are swept by: a marker whose owner is `alive` or `unknown` stands, and one whose owner
 * is `gone` may be broken. Any program running as the same user can write this directory, so a
 * marker is never a trust anchor: a planted one denies service until it is removed, and nothing here
 * keeps such a program out.
 *
 * ## Why a marker is published by `link()`
 *
 * The record goes to an owner-only temp file, which is flushed and then hard-linked to the marker's
 * name. `link` fails with `EEXIST` when anything is there, so two publishers cannot both win, and the
 * marker appears complete or not at all: a crash can no longer leave an empty or partial marker that
 * reads `unknown` forever. A temp file a crash leaves behind has another name and is never read as a
 * marker.
 *
 * ## Why only the holder of the break lock moves a marker
 *
 * Breaking a gone owner's marker is a read, then a removal, and two breakers that both judged the
 * same marker would otherwise each remove what the other published in between. So every rename or
 * unlink of a marker — breaking a gone one, taking over or ending a lease, a release, a removal — is
 * made by the holder of `<dir>/<name>.break`, published the same way. Under it the holder re-reads
 * the marker, renames it to a sidecar of its own, confirms the moved file is the one it judged (same
 * device, inode and content), and only then unlinks it; a mismatch is put back with `link()`. A lock
 * whose owner is gone, or that is older than a break could take, is stale and is removed the same
 * way. A lock taken from a holder that was still working is the window this cannot close, which is
 * why every handle re-verifies its own marker before each write ({@link IProcessMarkerHandle.holds}):
 * a writer that lost its marker fails closed.
 *
 * ## Why this process knows its own markers from memory
 *
 * On a platform that reads no start time a live owner, this process included, is `unknown` by its
 * record alone, so a marker this process published is recognised as its own by what it remembers
 * publishing (the file's device, inode and content), never by liveness. The memory is per process,
 * shared by every copy of this module loaded in it.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import {
  OwnerOnlyModeError,
  OwnerOnlyWriteUnconfirmedError,
  ensureOwnerOnlyDirectory,
  writeOwnerOnlyFile,
} from './owner-only-store.js';
import {
  MAX_OWNER_RECORD_BYTES,
  classifyProcessOwner,
  parseProcessOwnerRecord,
  processOwnerRecordFields,
} from './process-owner-record.js';
import { readCurrentProcessIdentity } from './process-identity.js';

import type { IOwnerOnlyDurability } from './owner-only-store.js';
import type { IProcessOwnerProbes } from './process-owner-record.js';
import type {
  IProcessIdentity,
  IProcessMarkerAcquireOptions,
  IProcessMarkerHandle,
  IProcessMarkerHolder,
  IProcessMarkerOperationLock,
  IProcessMarkerRemoveOptions,
  IProcessMarkers,
  TProcessMarkerAcquireResult,
  TProcessMarkerRemoveResult,
  TProcessMarkerState,
  TProcessMarkerTakeOverResult,
} from '../interfaces/process-marker.js';

/** What a marker's file name ends with; nothing else in the directory is a marker. */
export const PROCESS_MARKER_SUFFIX = '.owner';
/** What a marker's break lock's file name ends with. */
const BREAK_LOCK_SUFFIX = '.break';
/** How long an operation waits for another process's break to finish before it reports `busy`. */
const DEFAULT_LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 10;
/** Publish, judge and break again at most this often before reporting what stands. */
const MAX_ATTEMPTS = 4;
/** A name is one path component: letters, digits, dot, underscore or hyphen, starting with a letter or digit. */
const MARKER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** A file at a marker or lock path, as read whole through one descriptor. */
interface IMarkerFile {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly bytes: Buffer;
  readonly mtimeMs: number;
  /** The owner the record names; absent when it is not an owner record. */
  readonly owner?: IProcessIdentity;
  readonly leaseDigest?: string;
}

/** A file this process put in place, as it remembers it. */
interface IPublishedFile {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly bytes: Buffer;
}

/** What one process remembers publishing, by absolute path. */
export type TProcessMarkerMemory = Map<string, IPublishedFile>;

const PROCESS_MEMORY_KEY = Symbol.for('@robota-sdk/agent-core:process-marker-memory');

/** This process's memory, shared by every copy of this module it loaded (an ES and a CommonJS build). */
function processMemory(): TProcessMarkerMemory {
  const global = globalThis as { [PROCESS_MEMORY_KEY]?: TProcessMarkerMemory };
  global[PROCESS_MEMORY_KEY] ??= new Map();
  return global[PROCESS_MEMORY_KEY];
}

/** A memory of its own, for a test that plays several processes in one. */
export function createProcessMarkerMemory(): TProcessMarkerMemory {
  return new Map();
}

/**
 * Seams between the steps of a break, so a test can run another process's operation at exactly that
 * point. Each runs synchronously, inside the operation.
 */
export interface IProcessMarkerSteps {
  /** Under the break lock, the marker was re-read and judged; nothing has moved yet. */
  readonly judged?: (name: string) => void;
  /** The judged marker is in its sidecar, not yet confirmed; nothing stands at the path. */
  readonly movedAside?: (name: string) => void;
  /** A marker is complete in its temp file and about to be linked into place. */
  readonly publishing?: (name: string) => void;
}

/** How a {@link createProcessMarkers} directory is kept. */
export interface IProcessMarkersOptions extends IProcessOwnerProbes, IOwnerOnlyDurability {
  /** Host-supplied process operation lock for this exact marker directory. */
  readonly operationLock: IProcessMarkerOperationLock;
  /** What this process remembers publishing; the process's own by default. */
  readonly memory?: TProcessMarkerMemory;
  /** The clock used to bound lock waits; `Date.now` by default. */
  readonly now?: () => number;
  /** How long to wait for another process's break before reporting `busy`; two seconds by default. */
  readonly lockWaitMs?: number;
  readonly steps?: IProcessMarkerSteps;
  /** Seam for the hard link that publishes, so a filesystem without hard links is reachable from a test. */
  readonly linkFile?: (existingPath: string, newPath: string) => void;
}

/** Raised for a name that is not one path component, or a marker directory that is not a real one. */
export class ProcessMarkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessMarkerError';
  }
}

function errnoCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { readonly code?: unknown }).code
    : undefined;
}

const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

/** Waits synchronously: every operation here is synchronous, as the stores that call it are. */
function sleepSync(ms: number): void {
  Atomics.wait(SLEEP_CELL, 0, 0, ms);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** A name nothing else in the directory can be. */
function uniqueName(path: string, kind: 'tmp' | 'aside'): string {
  return `${path}.${process.pid}.${randomBytes(6).toString('hex')}.${kind}`;
}

/**
 * The file at `path`, read whole through one descriptor, or undefined when nothing is there. A link,
 * a directory or a file too large to be a record is still something standing, read as no record.
 */
function readMarkerFile(path: string): IMarkerFile | undefined {
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return undefined;
    throw error;
  }
  const empty = {
    dev: stat.dev,
    ino: stat.ino,
    bytes: Buffer.alloc(0),
    mtimeMs: Number(stat.mtimeMs),
  };
  if (!stat.isFile() || stat.size > BigInt(MAX_OWNER_RECORD_BYTES)) return empty;
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return undefined;
    return empty;
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const bytes = Buffer.alloc(Math.min(Number(opened.size), MAX_OWNER_RECORD_BYTES));
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    const file = {
      dev: opened.dev,
      ino: opened.ino,
      bytes: bytes.subarray(0, offset),
      mtimeMs: Number(opened.mtimeMs),
    };
    return { ...file, ...parseMarkerRecord(file.bytes) };
  } finally {
    closeSync(descriptor);
  }
}

/** The owner and lease digest a marker's bytes name; neither when they are not a marker record. */
function parseMarkerRecord(bytes: Buffer): Pick<IMarkerFile, 'owner' | 'leaseDigest'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return {}; // allow-fallback: bytes that are not a record name no owner, which is `unknown`.
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const { leaseDigest, ...rest } = parsed as Record<string, unknown>;
  if (
    leaseDigest !== undefined &&
    (typeof leaseDigest !== 'string' || !SHA256_HEX.test(leaseDigest))
  ) {
    return {};
  }
  const owner = parseProcessOwnerRecord(rest);
  if (owner === undefined) return {};
  return leaseDigest === undefined ? { owner } : { owner, leaseDigest };
}

function sameFile(left: IPublishedFile, right: IPublishedFile): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.bytes.equals(right.bytes);
}

/** The markers kept in `directory`; see the module documentation. */
class FileProcessMarkers implements IProcessMarkers {
  readonly #directory: string;
  readonly #options: IProcessMarkersOptions;
  readonly #memory: TProcessMarkerMemory;
  #prepared = false;

  constructor(directory: string, options: IProcessMarkersOptions, openedDirectory = false) {
    if (typeof options?.operationLock?.tryAcquire !== 'function') {
      throw new ProcessMarkerError(
        'Process markers require an operation lock for their directory.',
      );
    }
    this.#directory = resolve(directory);
    this.#options = options;
    this.#memory = options.memory ?? processMemory();
    this.#prepared = openedDirectory;
  }

  acquire(name: string, options: IProcessMarkerAcquireOptions = {}): TProcessMarkerAcquireResult {
    const path = this.#markerPath(name, true);
    const leaseDigest = options.leaseDigest;
    if (leaseDigest !== undefined && !SHA256_HEX.test(leaseDigest)) {
      throw new ProcessMarkerError('A lease digest is the SHA-256 of the nonce, in lowercase hex.');
    }
    const content = this.#recordText(leaseDigest);
    let holder: IProcessMarkerHolder = { self: false, liveness: 'unknown' };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const published = this.#publish(name, path, content);
      if (published !== 'exists') return this.#acquired(name, path, published);
      const standing = readMarkerFile(path);
      if (standing === undefined) continue;
      holder = this.#holderOf(path, standing);
      if (holder.liveness !== 'gone') return { status: 'held', holder };
      const broken = this.#withBreakLock(name, (ownsLock) => {
        const again = readMarkerFile(path);
        if (again !== undefined) {
          if (this.#holderOf(path, again).liveness !== 'gone') return 'standing';
          this.#options.steps?.judged?.(name);
          if (!ownsLock() || !this.#moveAsideConfirmed(name, path, again)) return 'standing';
        }
        if (!ownsLock()) return 'standing';
        return this.#publish(name, path, content);
      });
      if (broken === 'busy') return { status: 'held', holder };
      if (broken !== 'standing' && broken !== 'exists') {
        return this.#acquired(name, path, broken);
      }
    }
    const last = readMarkerFile(path);
    return { status: 'held', holder: last === undefined ? holder : this.#holderOf(path, last) };
  }

  takeOver(name: string, nonce: string): TProcessMarkerTakeOverResult {
    const path = this.#markerPath(name);
    const digest = sha256Hex(nonce);
    const standing = readMarkerFile(path);
    if (standing === undefined) return { status: 'absent' };
    if (standing.leaseDigest !== digest)
      return { status: 'held', holder: this.#holderOf(path, standing) };
    const content = this.#recordText(digest);
    const taken = this.#withBreakLock(name, (ownsLock): TProcessMarkerTakeOverResult => {
      const again = readMarkerFile(path);
      if (again === undefined) return { status: 'absent' };
      if (again.leaseDigest !== digest)
        return { status: 'held', holder: this.#holderOf(path, again) };
      this.#options.steps?.judged?.(name);
      if (!ownsLock() || !this.#moveAsideConfirmed(name, path, again)) {
        const now = readMarkerFile(path);
        return now === undefined
          ? { status: 'absent' }
          : { status: 'held', holder: this.#holderOf(path, now) };
      }
      // Publishing is a link, which can never replace what another process published meanwhile.
      const published = this.#publish(name, path, content);
      if (published === 'exists') {
        const now = readMarkerFile(path);
        return now === undefined
          ? { status: 'absent' }
          : { status: 'held', holder: this.#holderOf(path, now) };
      }
      return this.#acquired(name, path, published);
    });
    return taken === 'busy' ? { status: 'held', holder: this.#holderOf(path, standing) } : taken;
  }

  endLease(name: string, leaseDigest: string): boolean {
    const path = this.#markerPath(name);
    const standing = readMarkerFile(path);
    if (standing === undefined || standing.leaseDigest !== leaseDigest) return false;
    const ended = this.#withBreakLock(name, (ownsLock) => {
      const again = readMarkerFile(path);
      if (again === undefined || again.leaseDigest !== leaseDigest) return false;
      this.#options.steps?.judged?.(name);
      if (!ownsLock() || !this.#moveAsideConfirmed(name, path, again)) return false;
      this.#forgetIfRemembered(path, again);
      return true;
    });
    return ended === true;
  }

  inspect(name: string): TProcessMarkerState {
    const path = this.#markerPath(name);
    const standing = readMarkerFile(path);
    return standing === undefined
      ? { status: 'absent' }
      : { status: 'held', holder: this.#holderOf(path, standing) };
  }

  remove(name: string, options: IProcessMarkerRemoveOptions = {}): TProcessMarkerRemoveResult {
    const path = this.#markerPath(name);
    const force = options.force === true;
    const standing = readMarkerFile(path);
    if (standing === undefined) return { status: 'absent' };
    const holder = this.#holderOf(path, standing);
    if (!force && holder.liveness !== 'gone') return { status: 'held', holder };
    const removed = this.#withBreakLock(name, (ownsLock): TProcessMarkerRemoveResult => {
      const again = readMarkerFile(path);
      if (again === undefined) return { status: 'absent' };
      const judged = this.#holderOf(path, again);
      if (!force && judged.liveness !== 'gone') return { status: 'held', holder: judged };
      this.#options.steps?.judged?.(name);
      if (!ownsLock() || !this.#moveAsideConfirmed(name, path, again)) return { status: 'busy' };
      this.#forgetIfRemembered(path, again);
      return { status: 'removed', holder: judged };
    });
    return removed === 'busy' ? { status: 'busy' } : removed;
  }

  /** The record this process publishes, with `leaseDigest` when lent. */
  #recordText(leaseDigest: string | undefined): string {
    const fields = processOwnerRecordFields(this.#options.current ?? readCurrentProcessIdentity());
    const generation = randomBytes(16).toString('hex');
    return JSON.stringify(
      leaseDigest === undefined ? { ...fields, generation } : { ...fields, generation, leaseDigest },
    );
  }

  /** Who holds `file` at `path`: this process when it remembers publishing exactly it, else by its record. */
  #holderOf(path: string, file: IMarkerFile): IProcessMarkerHolder {
    const published = this.#memory.get(path);
    const owner = file.owner;
    if (published !== undefined && sameFile(published, file)) {
      return { ...(owner === undefined ? {} : { owner }), self: true, liveness: 'alive' };
    }
    if (owner === undefined) return { self: false, liveness: 'unknown' };
    return { owner, self: false, liveness: classifyProcessOwner(owner, this.#options) };
  }

  #acquired(
    name: string,
    path: string,
    published: IPublishedFile,
  ): { readonly status: 'acquired'; readonly handle: IProcessMarkerHandle } {
    this.#memory.set(path, published);
    return { status: 'acquired', handle: this.#handle(name, path, published) };
  }

  #handle(name: string, path: string, published: IPublishedFile): IProcessMarkerHandle {
    let released = false;
    let inOperation = false;
    let pendingRelease = false;
    const forget = (): void => {
      const remembered = this.#memory.get(path);
      if (remembered !== undefined && sameFile(remembered, published)) this.#memory.delete(path);
    };
    // What it published, bytes included: a freed inode is handed to the next marker on some
    // filesystems, so device and inode alone name another process's marker as this one's.
    const isMine = (file: IMarkerFile | undefined): boolean =>
      file !== undefined && sameFile(published, file);
    const releaseMarker = (): void => {
      try {
        const outcome = this.#withBreakLock(name, (ownsLock) => {
          const again = readMarkerFile(path);
          if (!isMine(again)) return true;
          return ownsLock() && this.#moveAsideConfirmed(name, path, again as IMarkerFile);
        });
        if (outcome !== 'busy') forget();
      } catch {
        // allow-fallback: a marker that could not be removed is this process's until it ends.
      }
    };
    return Object.freeze({
      holds: (): boolean => {
        if (released) return false;
        let mine: boolean;
        try {
          mine = isMine(readMarkerFile(path));
        } catch {
          mine = false; // allow-fallback: a marker that cannot be read is not shown to be this one's.
        }
        if (!mine) forget();
        return mine;
      },
      withGuard: <T>(operation: () => T) => {
        if (released) return { status: 'lost' as const };
        try {
          const outcome = this.#withBreakLock(name, (ownsLock) => {
            if (released || !ownsLock() || !isMine(readMarkerFile(path)))
              return { status: 'lost' as const };
            inOperation = true;
            try {
              return { status: 'ran' as const, value: operation() };
            } finally {
              inOperation = false;
            }
          });
          return outcome === 'busy' ? { status: 'busy' as const } : outcome;
        } finally {
          if (pendingRelease) {
            pendingRelease = false;
            releaseMarker();
          }
        }
      },
      release: (): void => {
        if (released) return;
        released = true;
        if (inOperation) {
          pendingRelease = true;
          return;
        }
        releaseMarker();
      },
    });
  }

  /**
   * The marker path for `name`. The directory is checked not to be a link before anything is read
   * from it, and an operation that publishes (`create`) makes it owner-only on first use; one that
   * only reads or removes leaves a missing directory missing, where nothing stands.
   */
  #markerPath(name: string, create = false): string {
    if (typeof name !== 'string' || !MARKER_NAME.test(name)) {
      throw new ProcessMarkerError(
        'A marker name is one path component of letters, digits, dot, underscore or hyphen.',
      );
    }
    if (!this.#prepared) {
      // A directory that is a link would put the markers wherever it points, out of every reader's
      // sight, and tightening it would tighten its target; checked before anything is made.
      let exists = true;
      try {
        if (lstatSync(this.#directory).isSymbolicLink()) {
          throw new ProcessMarkerError('The marker directory is a symbolic link.');
        }
      } catch (error) {
        if (errnoCode(error) !== 'ENOENT') throw error;
        exists = false;
      }
      if (exists || create) {
        ensureOwnerOnlyDirectory(this.#directory);
        this.#prepared = true;
      }
    }
    return join(this.#directory, `${name}${PROCESS_MARKER_SUFFIX}`);
  }

  /**
   * Puts `content` at `path` by linking a flushed owner-only temp file there: `exists` when anything
   * stands at the path. A step after the link that failed leaves the marker complete, so it counts.
   */
  #publish(name: string, path: string, content: string, lock = false): IPublishedFile | 'exists' {
    const temporaryPath = uniqueName(path, 'tmp');
    let placed: { readonly dev: bigint; readonly ino: bigint } | undefined;
    try {
      writeOwnerOnlyFile(path, content, {
        createOnly: true,
        durable: true,
        temporaryPath,
        ...(this.#options.syncFile === undefined ? {} : { syncFile: this.#options.syncFile }),
        ...(this.#options.syncDirectory === undefined
          ? {}
          : { syncDirectory: this.#options.syncDirectory }),
        ...(this.#options.linkFile === undefined ? {} : { linkFile: this.#options.linkFile }),
        beforeCommit: () => {
          // The link keeps this inode, so what is published is known before anyone can see it.
          const descriptor = openSync(
            temporaryPath,
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
          );
          try {
            const stat = fstatSync(descriptor, { bigint: true });
            placed = { dev: stat.dev, ino: stat.ino };
          } finally {
            closeSync(descriptor);
          }
          if (!lock) this.#options.steps?.publishing?.(name);
        },
      });
    } catch (error) {
      if (errnoCode(error) === 'EEXIST') return 'exists';
      if (!(error instanceof OwnerOnlyWriteUnconfirmedError)) throw error;
    }
    if (placed === undefined) throw new OwnerOnlyModeError('A published marker was not observed.');
    return { ...placed, bytes: Buffer.from(content, 'utf8') };
  }

  /**
   * Renames `judged` at `path` to a sidecar, confirms the moved file is that one, and unlinks it; a
   * file that is not the one judged is put back with `link()`. Returns whether `judged` was removed.
   */
  #moveAsideConfirmed(name: string, path: string, judged: IMarkerFile): boolean {
    const aside = uniqueName(path, 'aside');
    try {
      renameSync(path, aside);
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return false;
      throw error;
    }
    this.#options.steps?.movedAside?.(name);
    const moved = readMarkerFile(aside);
    if (moved !== undefined && sameFile(moved, judged)) {
      unlinkSync(aside);
      return true;
    }
    try {
      linkSync(aside, path);
    } catch {
      // allow-fallback: something was published meanwhile; the file moved aside lost its place, and
      // its holder sees that before its next write.
    }
    unlinkSync(aside);
    return false;
  }

  /**
   * Runs `run` holding the break lock of `name`, with a check that the lock is still this call's;
   * `busy` when another process holds a fresh lock past the wait. A stale lock is removed first.
   */
  #withBreakLock<T>(name: string, run: (ownsLock: () => boolean) => T): T | 'busy' {
    const now = this.#options.now ?? Date.now;
    const deadline = now() + (this.#options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS);
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const operationLock = this.#options.operationLock.tryAcquire(name);
      if (operationLock !== undefined) {
        try {
          return this.#withLegacyBreakLock(name, run);
        } finally {
          operationLock.release();
        }
      }
      if (now() >= deadline) return 'busy';
      sleepSync(LOCK_POLL_MS);
    }
    return 'busy';
  }

  #withLegacyBreakLock<T>(name: string, run: (ownsLock: () => boolean) => T): T | 'busy' {
    const path = join(this.#directory, `${name}${BREAK_LOCK_SUFFIX}`);
    const now = this.#options.now ?? Date.now;
    const waitMs = this.#options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
    const deadline = now() + waitMs;
    const content = this.#recordText(undefined);
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const lock = this.#publish(name, path, content, true);
      if (lock !== 'exists') {
        this.#memory.set(path, lock);
        const ownsLock = (): boolean => {
          const standing = readMarkerFile(path);
          return standing !== undefined && sameFile(standing, lock);
        };
        try {
          return run(ownsLock);
        } finally {
          this.#memory.delete(path);
          const standing = readMarkerFile(path);
          if (standing !== undefined && sameFile(standing, lock)) this.#unlinkQuietly(path);
        }
      }
      const standing = readMarkerFile(path);
      if (standing === undefined) continue;
      if (this.#isStaleLock(path, standing)) {
        this.#moveAsideConfirmed(name, path, standing);
        continue;
      }
      if (now() >= deadline) return 'busy';
      sleepSync(LOCK_POLL_MS);
    }
    return 'busy';
  }

  /** Only a lock whose owner is provably gone can be recovered. */
  #isStaleLock(path: string, lock: IMarkerFile): boolean {
    const holder = this.#holderOf(path, lock);
    return !holder.self && holder.liveness === 'gone';
  }

  /** Forgets `removed` at `path` if this process remembers publishing exactly it. */
  #forgetIfRemembered(path: string, removed: IPublishedFile): void {
    const remembered = this.#memory.get(path);
    if (remembered !== undefined && sameFile(remembered, removed)) this.#memory.delete(path);
  }

  #unlinkQuietly(path: string): void {
    try {
      unlinkSync(path);
    } catch {
      // allow-fallback: a lock that cannot be removed stays until its owner is provably gone.
    }
  }
}

/**
 * The exclusive markers kept in `directory`, created owner-only on first use. The directory holds
 * only markers, their break locks and the temp and sidecar files of each, so it must be one the
 * host keeps for this purpose.
 */
export function createProcessMarkers(
  directory: string,
  options: IProcessMarkersOptions,
): IProcessMarkers {
  return new FileProcessMarkers(directory, options);
}

/**
 * Markers relative to an already opened directory descriptor on Linux. The caller retains the
 * descriptor until all handles have been released and is responsible for naming/authority checks,
 * and supplies the operation lock for that same directory like any other marker directory.
 */
export function createProcessMarkersInOpenDirectory(
  descriptor: number,
  options: IProcessMarkersOptions,
): IProcessMarkers {
  if (process.platform !== 'linux' || !Number.isInteger(descriptor) || descriptor < 0) {
    throw new ProcessMarkerError('An open marker directory requires a Linux directory descriptor.');
  }
  if (!fstatSync(descriptor).isDirectory()) {
    throw new ProcessMarkerError('The opened marker target must be a directory.');
  }
  return new FileProcessMarkers(
    `/proc/self/fd/${descriptor}`,
    { ...options, memory: options.memory ?? createProcessMarkerMemory() },
    true,
  );
}
