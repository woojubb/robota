/**
 * The keyring file: `<user root>/secure/keyring.json`, the passphrase- and recovery-wrapped master key
 * plus the sealing public key a locked writer needs.
 *
 * Every program of this user can read the file, so what protects it is the passphrase's strength, not
 * the mode; the mode, the ownership check and the refusal of links only keep a file that is not the
 * owner's, or not a file, from being read as one. A refusal names the rule and the path and never
 * quotes the file: a malformed keyring may be anything, including a secret pasted into the wrong place.
 *
 * Every change is made under one lock file beside the keyring, and only to the keyring it was built
 * from: `save` replaces the file only while it still holds `expected`, and `create` only where nothing
 * is. Without that, a repair built on a snapshot taken before a slow unlock could put back a passphrase
 * slot that a concurrent change had just replaced. The lock is held for file work only, never across a
 * key derivation, so a live holder is never waited on for long.
 *
 * The lock names its holder by host, boot and (on Linux) pid namespace as well as pid, because the
 * home directory may be shared by other machines or containers whose pids mean nothing here. A pid is
 * probed only for a holder on this very machine; any other lock is judged by its age alone, measured
 * on the filesystem's clock (the lock file's time against a file made just now), so neither a reader
 * on another machine nor a step of this machine's wall clock breaks a fresh lock. A holder on this
 * machine is aged by the system's monotonic clock instead, which no wall-clock step moves.
 *
 * Saves are atomic and durable (temp file, flush, rename, flush the directory) and verified by reading
 * the result back; a failure after the rename is reported as `committed-unconfirmed`, because the new
 * keyring is then most likely in place. There is deliberately no backup of the previous keyring: an
 * old passphrase slot would stay unlockable after the passphrase was changed.
 */
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { hostname } from 'node:os';

import { readWindowsKeyringFile, removeWindowsMarker } from './windows-keyring-read.js';
import { basename, dirname, join } from 'node:path';

import {
  KeyringError,
  parseKeyring,
  serializeKeyring,
  type IKeyring,
} from '@robota-sdk/agent-keyring';
import {
  OWNER_ONLY_FILE_MODE,
  OwnerOnlyWriteUnconfirmedError,
  ensureOwnerOnlyDirectory,
  readBootId,
  readPidNamespace,
  writeOwnerOnlyFile,
  type IOwnerOnlyDurability,
} from '@robota-sdk/agent-core/node';

import type { Stats } from 'node:fs';

/** A real keyring is a few hundred bytes; anything this large is not one and is not read. */
const MAX_KEYRING_FILE_BYTES = 64 * 1024;
/** A lock file holds a token, a process id, a machine and a time; anything larger is not one of ours. */
const MAX_LOCK_FILE_BYTES = 1024;
const GROUP_AND_OTHER_BITS = 0o077;
/**
 * A lock older than this is abandoned even if its holder may be alive: a holder does only file work
 * under it (a read, a flushed write and a read-back), far less than this on any working disk; a
 * process id can be reused after the holder died; and a holder on another machine cannot be probed.
 * A holder stalled for longer may therefore be overtaken, which its own checks before and after the
 * commit then report.
 */
const DEFAULT_LOCK_STALE_AFTER_MS = 30_000;
/** How long a save waits for a live holder before it refuses with `busy`. */
const DEFAULT_LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 25;

/** Why the store refused. A caller decides on `code`, never on the message. */
export type TKeyringStoreErrorCode =
  | 'missing'
  | 'symlink'
  | 'not-regular-file'
  | 'foreign-owner'
  | 'too-large'
  | 'unreadable'
  | 'malformed'
  | 'unsupported-version'
  | 'exists'
  | 'changed'
  | 'busy'
  | 'write-failed'
  | 'committed-unconfirmed'
  | 'verify-failed';

const MESSAGES: Readonly<Record<TKeyringStoreErrorCode, string>> = {
  missing: 'There is no keyring yet.',
  symlink: 'The keyring path is a symbolic link; it is refused rather than followed.',
  'not-regular-file': 'The keyring path is not a regular file.',
  'foreign-owner': 'The keyring file belongs to another account; it is refused.',
  'too-large': 'The keyring file is far larger than any keyring; it is refused unread.',
  unreadable: 'The keyring file could not be read.',
  malformed: 'The keyring file is not a valid keyring.',
  'unsupported-version': 'The keyring file is from a newer version that this build cannot read.',
  exists: 'A keyring already exists; it was not replaced.',
  changed: 'The keyring changed since it was read; nothing was written.',
  busy: 'Another process is changing the keyring; nothing was written.',
  'write-failed': 'The keyring could not be written.',
  'committed-unconfirmed':
    'The new keyring was put in place, but confirming that it reached the disk failed.',
  'verify-failed': 'The keyring was written but reading it back did not give the same keyring.',
};

/**
 * The store's only deliberate error. The message is fixed text, the path, and for a failed write the
 * error's name or errno code; it never quotes file content or an underlying error's message.
 */
export class KeyringStoreError extends Error {
  readonly code: TKeyringStoreErrorCode;
  readonly path: string;
  /** The errno code or error class behind a failed write, when there was one. */
  readonly reason?: string;

  constructor(code: TKeyringStoreErrorCode, path: string, reason?: string) {
    super(`${MESSAGES[code]}${reason === undefined ? '' : ` [${reason}]`} (${path})`);
    this.name = 'KeyringStoreError';
    this.code = code;
    this.path = path;
    if (reason !== undefined) this.reason = reason;
  }
}

/** The errno code, or the error class name: enough to tell a full disk from a refused mode, quoting nothing. */
function reasonOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.name : 'unknown';
}

export type TKeyringLoadResult =
  { readonly status: 'missing' } | { readonly status: 'present'; readonly keyring: IKeyring };

/** What the file system says about the keyring path, read without opening the file or changing it. */
export interface IKeyringFileState {
  readonly exists: boolean;
  /** `file`, `symlink` or `other`; only meaningful when it exists. */
  readonly kind?: 'file' | 'symlink' | 'other';
  /** Permission bits, e.g. `0o600`; `undefined` where the platform has none to report. */
  readonly mode?: number;
  /** Whether the account running this process owns the file; `undefined` where owners are not comparable. */
  readonly ownedByCurrentUser?: boolean;
}

export interface IKeyringStore {
  readonly path: string;
  /** Reads and parses the keyring, tightening a group- or world-readable mode first. */
  load(): TKeyringLoadResult;
  /** Writes `keyring` where there is none yet; `exists` when one is already there, which is left alone. */
  create(keyring: IKeyring): void;
  /**
   * Replaces the keyring with `keyring`, but only while the file still holds `expected`, the keyring
   * the change was built from; `changed` otherwise. Durable, atomic, and read back to confirm.
   */
  save(keyring: IKeyring, expected: IKeyring): void;
  /** The path's current state, for a report; it neither tightens nor reads. */
  inspect(): IKeyringFileState;
}

export interface IKeyringFileStoreOptions {
  /** The keyring file: `<user root>/secure/keyring.json`. */
  readonly path: string;
  /** The user root, which this host owns and tightens along with the `secure` directory. */
  readonly root: string;
  /** The account that must own the file; defaults to the running account (not checked on Windows). */
  readonly currentUserId?: number;
  /** Seams for the durable write, so a test can see the order of the flushes. */
  readonly durability?: IOwnerOnlyDurability;
  /** How long a change waits for another live process's lock; defaults to five seconds. */
  readonly lockWaitMs?: number;
  /** How old a lock is before it counts as abandoned; defaults to thirty seconds. A test seam. */
  readonly lockStaleAfterMs?: number;
  /** The machine this process runs on; defaults to the real one. A seam for a second "host" in a test. */
  readonly machine?: IMachineIdentity;
  /** Seam for the hard link `create` commits with, so a filesystem without hard links is reachable. */
  readonly linkFile?: (existingPath: string, newPath: string) => void;
}

function currentUserId(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function kindOf(stats: Stats): 'file' | 'symlink' | 'other' {
  if (stats.isSymbolicLink()) return 'symlink';
  return stats.isFile() ? 'file' : 'other';
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** `O_NOFOLLOW` refuses a link at open time; `O_NONBLOCK` keeps a FIFO from blocking the open. Neither exists on Windows. */
function openFlags(): number {
  return constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
}

/**
 * At most `limit + 1` bytes from an open descriptor, so a file that grew after its size was checked
 * is seen as too large instead of being read whole.
 */
function readBounded(descriptor: number, limit: number): Buffer {
  const buffer = Buffer.alloc(limit + 1);
  let filled = 0;
  while (filled < buffer.length) {
    const read = readSync(descriptor, buffer, filled, buffer.length - filled, null);
    if (read === 0) break;
    filled += read;
  }
  return buffer.subarray(0, filled);
}

/**
 * Which machine a process runs on, as far as a lock needs to know: its host name, its current boot
 * and, on Linux, its pid namespace. Two processes with equal values share a pid table and a monotonic
 * clock; anything else is another machine for the lock's purposes, even another container.
 */
export interface IMachineIdentity {
  readonly host: string;
  /** Absent where the platform offers none, and then no lock is ever taken as this machine's. */
  readonly bootId?: string;
  readonly pidNamespace?: string;
}

let currentMachine: IMachineIdentity | undefined;

/** This machine, read once: none of it changes while the process runs. */
function readCurrentMachine(): IMachineIdentity {
  if (currentMachine !== undefined) return currentMachine;
  const bootId = readBootId();
  const pidNamespace = readPidNamespace();
  currentMachine = {
    host: hostname(),
    ...(bootId === undefined ? {} : { bootId }),
    ...(pidNamespace === undefined ? {} : { pidNamespace }),
  };
  return currentMachine;
}

/** Whether `other` is provably this machine: same host, same known boot, same pid namespace. */
function isSameMachine(self: IMachineIdentity, other: IMachineIdentity): boolean {
  return (
    self.bootId !== undefined &&
    other.host === self.host &&
    other.bootId === self.bootId &&
    other.pidNamespace === self.pidNamespace
  );
}

/** A short tag for a machine, for temp file names: equal tags, equal machines. */
function machineTag(machine: IMachineIdentity): string {
  return createHash('sha256')
    .update(`${machine.host}\0${machine.bootId ?? ''}\0${machine.pidNamespace ?? ''}`)
    .digest('hex')
    .slice(0, 12);
}

/**
 * The system's monotonic clock in milliseconds. Every process of one boot reads the same clock, and
 * no wall-clock step moves it, so it ages a lock held on this machine and times the wait for one.
 */
function monotonicNowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

/** Whether a process with this id exists. `EPERM` means it does, under another account. */
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Blocks this thread for `ms`: the store is synchronous, and a wait for a lock is short. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** What a lock file says about its holder, and which file it was, so a break never removes a newer lock. */
type TLockIdentity =
  | { readonly kind: 'posix'; readonly stats: Stats }
  | {
      readonly kind: 'windows';
      readonly identity: Buffer;
      readonly modified: Buffer;
      readonly mtimeMs: number;
    };

interface ILockHolder {
  readonly file: TLockIdentity;
  /** Absent when the file is not one this store wrote (or was cut short before it was written). */
  readonly owner?: {
    readonly token: string;
    readonly pid: number;
    readonly machine: IMachineIdentity;
    /** The holder's monotonic clock when it took the lock; comparable only on the same machine. */
    readonly monotonicMs: number;
  };
}

function optionalString(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.length > 0 ? value : false;
}

function parseLock(text: string, file: TLockIdentity): ILockHolder {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const bootId = optionalString(value['bootId']);
    const pidNamespace = optionalString(value['pidNamespace']);
    // A pid of 0 or below would make `process.kill` probe a process group; it is not a holder.
    if (
      typeof value['token'] === 'string' &&
      Number.isSafeInteger(value['pid']) &&
      (value['pid'] as number) > 0 &&
      typeof value['host'] === 'string' &&
      bootId !== false &&
      pidNamespace !== false &&
      Number.isFinite(value['monotonicMs'])
    ) {
      return {
        file,
        owner: {
          token: value['token'],
          pid: value['pid'] as number,
          machine: {
            host: value['host'],
            ...(bootId === undefined ? {} : { bootId }),
            ...(pidNamespace === undefined ? {} : { pidNamespace }),
          },
          monotonicMs: value['monotonicMs'] as number,
        },
      };
    }
  } catch {
    // allow-fallback: an unreadable lock is judged by its age alone.
  }
  return { file };
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.ino === b.ino && a.dev === b.dev && a.mtimeMs === b.mtimeMs;
}

/** Errno codes with which a filesystem says it has no hard links to offer. */
const HARD_LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV']);

/** The link step of a create failed because the filesystem has no hard links; the create falls back. */
class HardLinkUnsupportedError extends Error {
  constructor(cause: unknown) {
    super('The filesystem refused a hard link.', { cause });
    this.name = 'HardLinkUnsupportedError';
  }
}

export function createKeyringFileStore(options: IKeyringFileStoreOptions): IKeyringStore {
  const { path, root } = options;
  const ownerId = options.currentUserId ?? currentUserId();
  const lockPath = `${path}.lock`;
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  const staleAfterMs = options.lockStaleAfterMs ?? DEFAULT_LOCK_STALE_AFTER_MS;
  const machine = (): IMachineIdentity => options.machine ?? readCurrentMachine();
  const escapedName = basename(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // This store names its temp files `<path>.<pid>-<machine tag>-<write>.tmp`, so a sweep can tell
  // whose they are and two writes never share one; `<path>.<pid>.tmp` is an earlier build's name.
  const temporaryName = new RegExp(
    `^${escapedName}\\.(\\d+)(?:-([0-9a-f]{12})-[0-9a-f]{16})?\\.tmp$`,
  );

  /** The refusal for the path as it is, decided from `lstat` so a link is seen as a link. */
  function refusalFor(stats: Stats): TKeyringStoreErrorCode | undefined {
    if (stats.isSymbolicLink()) return 'symlink';
    if (!stats.isFile()) return 'not-regular-file';
    if (ownerId !== undefined && stats.uid !== ownerId) return 'foreign-owner';
    if (stats.size > MAX_KEYRING_FILE_BYTES) return 'too-large';
    return undefined;
  }

  function load(): TKeyringLoadResult {
    let content: Buffer;
    if (process.platform === 'win32') {
      let result: ReturnType<typeof readWindowsKeyringFile>;
      try {
        result = readWindowsKeyringFile(path, MAX_KEYRING_FILE_BYTES);
      } catch {
        throw new KeyringStoreError('unreadable', path);
      }
      if (result.status === 'missing') return { status: 'missing' };
      if (result.status !== 'present') throw new KeyringStoreError(result.status, path);
      content = result.content;
    } else {
      let before: Stats;
      try {
        before = lstatSync(path);
      } catch (error) {
        if (isMissing(error)) return { status: 'missing' };
        throw new KeyringStoreError('unreadable', path);
      }
      const refusal = refusalFor(before);
      if (refusal !== undefined) throw new KeyringStoreError(refusal, path);

      let descriptor: number | undefined;
      try {
        descriptor = openSync(path, openFlags());
        // What was opened must be what was checked: a swap between the check and the open shows up as
        // a different file, and every decision below is made on the open descriptor.
        const opened = fstatSync(descriptor);
        if (opened.ino !== before.ino || opened.dev !== before.dev) {
          throw new KeyringStoreError('unreadable', path);
        }
        const openedRefusal = refusalFor(opened);
        if (openedRefusal !== undefined) throw new KeyringStoreError(openedRefusal, path);
        if ((opened.mode & GROUP_AND_OTHER_BITS) !== 0) {
          try {
            fchmodSync(descriptor, OWNER_ONLY_FILE_MODE);
          } catch {
            // allow-fallback: tightening is best effort; the passphrase, not the mode, is what protects the keyring, and `inspect` reports a mode that stays wide.
          }
        }
        content = readBounded(descriptor, MAX_KEYRING_FILE_BYTES);
      } catch (error) {
        if (error instanceof KeyringStoreError) throw error;
        // ELOOP: the link was swapped in after the check; the open itself refused to follow it.
        throw new KeyringStoreError(
          (error as NodeJS.ErrnoException).code === 'ELOOP' ? 'symlink' : 'unreadable',
          path,
        );
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
      if (content.length > MAX_KEYRING_FILE_BYTES) throw new KeyringStoreError('too-large', path);
    }
    try {
      return { status: 'present', keyring: parseKeyring(content.toString('utf8')) };
    } catch (error) {
      // The parser's own message names a field, never content; it is still dropped so nothing it holds can reach output.
      throw new KeyringStoreError(
        error instanceof KeyringError && error.code === 'unsupported-version'
          ? 'unsupported-version'
          : 'malformed',
        path,
      );
    }
  }

  /** The current lock file, or `undefined` when there is none. */
  function readLock(): ILockHolder | undefined {
    if (process.platform === 'win32') {
      const result = readWindowsKeyringFile(lockPath, MAX_LOCK_FILE_BYTES);
      if (result.status === 'missing') return undefined;
      if (result.status !== 'present' && result.status !== 'too-large')
        throw new Error('Could not safely read the lock marker.');
      return parseLock(result.status === 'present' ? result.content.toString('utf8') : '', {
        kind: 'windows',
        identity: result.identity,
        modified: result.modified,
        mtimeMs: result.mtimeMs,
      });
    }
    let descriptor: number | undefined;
    try {
      descriptor = openSync(lockPath, openFlags());
      const stats = fstatSync(descriptor);
      return parseLock(readBounded(descriptor, MAX_LOCK_FILE_BYTES).toString('utf8'), {
        kind: 'posix',
        stats,
      });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  /**
   * The filesystem's "now": the modification time of a file made for the purpose and removed again.
   * Compared with another file's time it gives an age on one clock, the one every writer of this
   * directory shares, whatever the clock of the machine asking says. `undefined` when no such file
   * can be made, and then nothing is judged old.
   */
  function filesystemNowMs(token: string): number | undefined {
    const probe = `${lockPath}.${token}.probe`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(probe, 'wx', OWNER_ONLY_FILE_MODE);
      return fstatSync(descriptor).mtimeMs;
    } catch {
      return undefined; // allow-fallback: without the filesystem's time no lock or temp file is judged old, so nothing live is removed.
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(probe, { force: true });
    }
  }

  /** Whether a file is older than the stale bound on the filesystem's clock; never for a time in the future. */
  function isOldOnFilesystem(
    stats: { readonly mtimeMs: number },
    now: number | undefined,
  ): boolean {
    return now !== undefined && now - stats.mtimeMs > staleAfterMs;
  }

  /**
   * Whether the holder of `holder` has abandoned it. Its pid is probed only when it runs on this very
   * machine, where a dead pid settles it and a live one is still bounded by age on the shared
   * monotonic clock (the pid may have been reused). Any other lock — another host, another boot,
   * another container, or a file this store did not write — is judged by its age on the filesystem's
   * clock alone. A time in the future is never old, so a clock step cannot break a fresh lock.
   */
  function isAbandoned(holder: ILockHolder, token: string): boolean {
    const owner = holder.owner;
    if (owner !== undefined && isSameMachine(machine(), owner.machine)) {
      if (!processExists(owner.pid)) return true;
      return monotonicNowMs() - owner.monotonicMs > staleAfterMs;
    }
    return isOldOnFilesystem(
      holder.file.kind === 'windows' ? holder.file : holder.file.stats,
      filesystemNowMs(token),
    );
  }

  /**
   * Removes an abandoned lock, but only the one that was judged: if another process broke it and
   * took the lock since, the path now names a newer file, which is left alone. The window between
   * that check and the removal remains; `assertHeld`, which every holder runs immediately before it
   * commits and again after it reads the result back, narrows what can slip through it.
   */
  function breakLock(holder: ILockHolder): void {
    try {
      if (holder.file.kind === 'windows') {
        removeWindowsMarker(lockPath, holder.file.identity, holder.file.modified);
      } else if (sameFile(lstatSync(lockPath), holder.file.stats)) {
        unlinkSync(lockPath);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  function acquireLock(): string {
    const token = randomBytes(16).toString('hex');
    const self = machine();
    const deadline = monotonicNowMs() + lockWaitMs;
    // Bounded even if locks keep appearing and being broken, so this can never spin forever.
    const maxAttempts = Math.ceil(lockWaitMs / LOCK_POLL_MS) + 16;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let descriptor: number | undefined;
      try {
        descriptor = openSync(lockPath, 'wx', OWNER_ONLY_FILE_MODE);
        writeSync(
          descriptor,
          JSON.stringify({
            token,
            pid: process.pid,
            host: self.host,
            ...(self.bootId === undefined ? {} : { bootId: self.bootId }),
            ...(self.pidNamespace === undefined ? {} : { pidNamespace: self.pidNamespace }),
            monotonicMs: monotonicNowMs(),
          }),
        );
        return token;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          // A lock this call created but could not fill would otherwise block others until it is stale.
          if (descriptor !== undefined) {
            closeSync(descriptor);
            descriptor = undefined;
            rmSync(lockPath, { force: true });
          }
          throw error;
        }
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
      const holder = readLock();
      if (holder === undefined) continue;
      if (isAbandoned(holder, token)) {
        breakLock(holder);
        continue;
      }
      if (monotonicNowMs() >= deadline) break;
      sleepSync(LOCK_POLL_MS);
    }
    throw new KeyringStoreError('busy', path);
  }

  /** Whether the lock is still this holder's: nobody judged it abandoned and took it over. */
  function stillHeld(token: string): boolean {
    try {
      return readLock()?.owner?.token === token;
    } catch {
      return false; // allow-fallback: a lock that cannot be read is not provably this holder's.
    }
  }

  function assertHeld(token: string): void {
    if (!stillHeld(token)) throw new KeyringStoreError('busy', path);
  }

  function releaseLock(token: string): void {
    try {
      const holder = readLock();
      if (holder?.owner?.token !== token) return;
      if (holder.file.kind === 'windows') {
        removeWindowsMarker(lockPath, holder.file.identity, holder.file.modified);
      } else {
        unlinkSync(lockPath);
      }
    } catch {
      // allow-fallback: a lock that cannot be removed is broken by the next writer once it is stale.
    }
  }

  /**
   * Temp files a save that died left behind hold a keyring that is not the current one and must not
   * outlive the next save. Under the lock no cooperating writer is between its temp file and its
   * commit — except one stalled past the stale bound, whose file may still be renamed. So a temp file
   * of this machine goes when its process is gone; any other (another machine's, or an untagged one
   * from an earlier build) only once it is older than the stale bound on the filesystem's clock.
   */
  function removeStaleTemporaryFiles(token: string): void {
    let names: string[];
    try {
      names = readdirSync(dirname(path));
    } catch {
      return; // allow-fallback: a directory that cannot be listed cannot hold the file being saved either; the save reports that.
    }
    // Without a known boot no pid can be told to be this machine's, so every file is judged by age.
    const ownTag = machine().bootId === undefined ? undefined : machineTag(machine());
    let now: number | undefined | null = null;
    for (const name of names) {
      const match = temporaryName.exec(name);
      if (match === null) continue;
      const file = join(dirname(path), name);
      const pid = Number(match[1]);
      if (match[2] !== undefined && match[2] === ownTag && pid > 0 && !processExists(pid)) {
        rmSync(file, { force: true });
        continue;
      }
      let stats: Stats;
      try {
        stats = lstatSync(file);
      } catch {
        continue; // allow-fallback: a temp file that is already gone needs no sweeping.
      }
      if (!stats.isFile()) continue;
      if (now === null) now = filesystemNowMs(token);
      if (isOldOnFilesystem(stats, now)) rmSync(file, { force: true });
    }
  }

  /** Runs `change` under the lock, with stale temp files swept first; the lock is released whatever happens. */
  function underLock(change: (token: string) => void): void {
    let token: string;
    try {
      // Durable: the first `secure setup` creates `secure/` (and perhaps the root), and the keyring has
      // no other copy, so the entries of what this creates are flushed along with the file.
      ensureOwnerOnlyDirectory(dirname(path), {
        withinRoot: root,
        durable: true,
        syncDirectory: options.durability?.syncDirectory,
      });
      token = acquireLock();
    } catch (error) {
      if (error instanceof KeyringStoreError) throw error;
      throw new KeyringStoreError('write-failed', path, reasonOf(error));
    }
    try {
      removeStaleTemporaryFiles(token);
      change(token);
    } finally {
      releaseLock(token);
    }
  }

  /** The link `create` commits with; a filesystem without hard links is told apart from other failures. */
  function linkOrSayUnsupported(existingPath: string, newPath: string): void {
    try {
      (options.linkFile ?? linkSync)(existingPath, newPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (typeof code === 'string' && HARD_LINK_UNSUPPORTED.has(code)) {
        throw new HardLinkUnsupportedError(error);
      }
      throw error;
    }
  }

  /**
   * Writes `document` and reads it back; the caller holds the lock. `check` runs immediately before
   * the commit (after the temp file is written and flushed), so what it checks is as fresh as it can
   * be; the lock is checked there too, and again after the read-back. `create` links the temp file
   * into place, which fails if anything is there by then; `create-by-rename` is the fallback for a
   * filesystem without hard links, where the absence was just checked under the lock.
   */
  function commit(
    document: string,
    token: string,
    mode: 'create' | 'create-by-rename' | 'replace',
    check: () => void,
  ): void {
    try {
      writeOwnerOnlyFile(path, document, {
        durable: true,
        createOnly: mode === 'create',
        temporaryPath: `${path}.${process.pid}-${machineTag(machine())}-${token.slice(0, 16)}.tmp`,
        linkFile: linkOrSayUnsupported,
        beforeCommit: () => {
          check();
          assertHeld(token);
        },
        ...options.durability,
      });
    } catch (error) {
      if (error instanceof KeyringStoreError || error instanceof HardLinkUnsupportedError) {
        throw error;
      }
      if (error instanceof OwnerOnlyWriteUnconfirmedError) {
        throw new KeyringStoreError('committed-unconfirmed', path, reasonOf(error.cause));
      }
      if (mode === 'create' && (error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new KeyringStoreError('exists', path);
      }
      throw new KeyringStoreError('write-failed', path, reasonOf(error));
    }
    let written: TKeyringLoadResult;
    try {
      written = load();
    } catch (error) {
      // The rename happened; only the confirmation failed.
      throw new KeyringStoreError(
        'committed-unconfirmed',
        path,
        error instanceof KeyringStoreError ? error.code : reasonOf(error),
      );
    }
    if (written.status !== 'present' || serializeKeyring(written.keyring) !== document) {
      throw new KeyringStoreError('verify-failed', path);
    }
    // The keyring went in, but if the lock was taken over meanwhile, another writer may be changing
    // the file now: that the result is still in place is no longer confirmed.
    if (!stillHeld(token)) throw new KeyringStoreError('committed-unconfirmed', path, 'lock-lost');
  }

  /** Nothing may be at the path: the check a rename makes where a hard link would have refused. */
  function assertAbsent(): void {
    try {
      lstatSync(path);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    throw new KeyringStoreError('exists', path);
  }

  function create(keyring: IKeyring): void {
    const document = serializeKeyring(keyring);
    underLock((token) => {
      try {
        commit(document, token, 'create', () => undefined);
      } catch (error) {
        if (!(error instanceof HardLinkUnsupportedError)) throw error;
        // No hard links here (some network and FUSE filesystems): rename instead, checking under the
        // lock immediately before it that the path is still empty. A writer that ignores the lock
        // could still create the file in that gap; a hard link would have refused it.
        commit(document, token, 'create-by-rename', assertAbsent);
      }
    });
  }

  function save(keyring: IKeyring, expected: IKeyring): void {
    const document = serializeKeyring(keyring);
    const expectedDocument = serializeKeyring(expected);
    const assertUnchanged = (): void => {
      const current = load();
      if (current.status !== 'present' || serializeKeyring(current.keyring) !== expectedDocument) {
        throw new KeyringStoreError('changed', path);
      }
    };
    underLock((token) => {
      assertUnchanged();
      try {
        // Checked again right before the rename: a writer that took over a lock this one held past
        // the stale bound has changed the file by then, and that is reported as `changed`, not
        // overwritten.
        commit(document, token, 'replace', assertUnchanged);
      } catch (error) {
        // A write that failed for want of the lock or of its temp file (which the writer that took
        // over may have swept) says `changed` when that is what happened to the file.
        if (
          error instanceof KeyringStoreError &&
          (error.code === 'busy' || error.code === 'write-failed')
        ) {
          assertUnchanged();
        }
        throw error;
      }
    });
  }

  function inspect(): IKeyringFileState {
    let stats: Stats;
    try {
      stats = lstatSync(path);
    } catch (error) {
      if (isMissing(error)) return { exists: false };
      throw new KeyringStoreError('unreadable', path);
    }
    return {
      exists: true,
      kind: kindOf(stats),
      ...(process.platform === 'win32' ? {} : { mode: stats.mode & 0o7777 }),
      ...(ownerId === undefined ? {} : { ownedByCurrentUser: stats.uid === ownerId }),
    };
  }

  return { path, load, create, save, inspect };
}
