/**
 * Creating a host directory or file that only its owner can read.
 *
 * A host application persists session records, logs, settings and device credentials under a directory
 * of its own choosing. They carry prompts, model output, tool results and, in the settings case,
 * provider credentials. On a shared workstation or a CI host, every other local account reads them
 * unless the mode says otherwise.
 *
 * WHERE that directory is belongs to the host, not here — this module knows only what has to be true
 * of whatever path it is handed, which is what lets it be tested without a filesystem layout.
 *
 * ## Why this is one module and not a constant each caller repeats
 *
 * `0o600` and `0o700` were already spelled out in five separate files before this existed, and the
 * repository had already learned — in `guarded-directory.ts`, for a pairing rendezvous — that the
 * constants are the easy half. The load-bearing part is that **`mkdirSync(path, { mode })` does not
 * set the mode of a directory that already exists.** `recursive: true` returns successfully and
 * silently adopts whatever mode is there. A directory left at 0777 by an earlier version, by a
 * shared CI checkout, or by another local user who pre-created it, becomes ours with no signal.
 *
 * Measured under umask 022 before this module existed: a session log directory pre-created at 0777
 * stayed 0777 through `mkdirSync(dir, { recursive: true, mode: 0o700 })`, and its 0600 records were
 * then removable and replaceable by any local account.
 *
 * The same holds for files. `writeFileSync(path, data, { mode })` applies the mode only when the
 * file is CREATED; an existing 0644 record keeps 0644 forever, so a store written by an older
 * version is never repaired by a newer one.
 *
 * So: create, then set the mode unconditionally, then VERIFY — and verification is what makes the
 * first two checkable rather than hopeful. It is also the only step that catches an owner we did not
 * expect, which `mkdir` and `chmod` between them cannot.
 *
 * ## Windows
 *
 * `chmodSync` on win32 toggles the read-only attribute and cannot express "owner only"; NTFS ACL
 * inheritance governs instead, and a user's profile directory is not readable by other unprivileged
 * accounts by default. The POSIX assertion is therefore not made there, and `ownerOnlyGuarantee()` reports which
 * guarantee is in force so a caller — and a test — can state the platform's actual claim rather than
 * assume the POSIX one everywhere. A store directory placed inside a world-writable parent on
 * Windows is NOT protected by this module, and that is recorded rather than papered over.
 */

import {
  chmodSync,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative as relativePath, sep } from 'node:path';

/** Owner read/write. Nothing for group, nothing for other. */
export const OWNER_ONLY_FILE_MODE = 0o600;
/** Owner read/write/traverse. The traverse bit is what keeps another account out of the directory. */
export const OWNER_ONLY_DIRECTORY_MODE = 0o700;

/** The bits that must be clear for the guarantee to hold: every group and other permission. */
const FORBIDDEN_BITS = 0o077;

/** Raised when a path cannot be made owner-only. Never swallowed into a weaker mode. */
export class OwnerOnlyModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerOnlyModeError';
  }
}

/**
 * Which guarantee this platform can actually make.
 *
 * `posix-mode` — the mode bits are asserted after every create and every write.
 * `windows-acl` — inherited NTFS ACLs govern; the POSIX assertion is not made and not claimed.
 */
export function ownerOnlyGuarantee(
  platform: string = process.platform,
): 'posix-mode' | 'windows-acl' {
  return platform === 'win32' ? 'windows-acl' : 'posix-mode';
}

/**
 * Seams for the failure paths, injected for the reason `guarded-directory.ts` states: a filesystem
 * that silently ignores `chmod` is a real condition — some network and FAT mounts do exactly that —
 * and it is the ONLY condition the verification step catches that create-then-chmod does not. Without
 * a seam that case is unreachable from a test, and a guard no test can reach is a guard nobody knows
 * is there. Measured: with these absent, deleting the verification entirely changed no test result.
 */
export interface IOwnerOnlyIo {
  readonly makeDirectory?: (target: string, mode: number) => void;
  readonly setMode?: (target: string, mode: number) => void;
  readonly readMode?: (target: string) => number;
}

export interface IEnsureOwnerOnlyOptions extends IOwnerOnlyIo {
  /**
   * An ANCESTOR of `directory` that the caller also owns, tightened along with every segment between
   * them.
   *
   * Needed because `mkdirSync(path, { recursive: true, mode })` applies the mode only to the
   * directories it CREATES. A store root an older version already made sits at whatever mode it was
   * given and this call would leave it there — which is the module's own headline defect surviving
   * one level up, on the very path it exists to protect.
   *
   * It is a parameter rather than a walk up to some inferred boundary because WHICH ancestors belong
   * to the caller is the caller's knowledge. This module must not guess that a parent is ours; it
   * would eventually chmod someone's home directory.
   */
  readonly withinRoot?: string;
  /** Refuse links in the owned path before creating or changing its directories. */
  readonly rejectSymlinks?: boolean;
  /**
   * Flush the parent of every directory this call creates, so the new entries survive a crash: a
   * flushed file in a directory whose own entry was never flushed is gone with it. Off by default;
   * a key store, which has no other copy, turns it on.
   */
  readonly durable?: boolean;
  /** Seam for the flush of `durable`; see {@link IOwnerOnlyDurability.syncDirectory}. */
  readonly syncDirectory?: (directory: string) => void;
}

/** `directory` and each ancestor of it that does not exist yet, outermost first. */
function missingDirectories(directory: string): string[] {
  const missing: string[] = [];
  let current = directory;
  for (;;) {
    try {
      lstatSync(current);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') break;
    }
    missing.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return missing;
}

/** Every directory from `root` down to `target`, outermost first. `root` must be an ancestor. */
function segmentsFromRoot(root: string, target: string): string[] {
  const relative = relativePath(root, target);
  if (relative.startsWith('..') || isAbsolute(relative)) {
    throw new OwnerOnlyModeError(
      `withinRoot ${root} is not an ancestor of ${target}, so this call cannot own the path between them.`,
    );
  }
  const parts = relative.split(sep).filter((part) => part.length > 0);
  const chain: string[] = [root];
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    chain.push(current);
  }
  return chain;
}

function assertOwnerOnly(target: string, kind: 'directory' | 'file', io: IOwnerOnlyIo = {}): void {
  if (ownerOnlyGuarantee() !== 'posix-mode') return;
  const mode = (io.readMode ?? ((path: string) => statSync(path).mode & 0o7777))(target);
  if ((mode & FORBIDDEN_BITS) !== 0) {
    throw new OwnerOnlyModeError(
      `${kind} ${target} is mode 0${mode.toString(8)} after being set owner-only; ` +
        'group or other permissions survived, so its contents are readable by another account.',
    );
  }
}

/** Refuse existing symbolic links in a caller-owned directory chain. */
export function assertUnlinkedOwnerDirectory(directory: string, withinRoot?: string): void {
  const owned = withinRoot === undefined ? [directory] : segmentsFromRoot(withinRoot, directory);
  for (const target of owned) {
    if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new OwnerOnlyModeError('An owner-only directory must not be a symbolic link.');
    }
  }
}

/**
 * Ensure `directory` exists and only its owner can enter it.
 *
 * The `chmod` is unconditional because `mkdir` does not touch an existing directory's mode, and the
 * `stat` afterwards is what turns two hopeful calls into a checked one.
 */
export function ensureOwnerOnlyDirectory(
  directory: string,
  options: IEnsureOwnerOnlyOptions = {},
): void {
  const makeDirectory =
    options.makeDirectory ??
    ((target: string, mode: number): void => {
      mkdirSync(target, { recursive: true, mode });
    });
  const setMode =
    options.setMode ?? ((target: string, mode: number): void => chmodSync(target, mode));
  const owned =
    options.withinRoot === undefined
      ? [directory]
      : segmentsFromRoot(options.withinRoot, directory);
  const refuseLinks = (): void => {
    if (options.rejectSymlinks === true) {
      assertUnlinkedOwnerDirectory(directory, options.withinRoot);
    }
  };
  refuseLinks();
  const missing = options.durable === true ? missingDirectories(directory) : [];
  makeDirectory(directory, OWNER_ONLY_DIRECTORY_MODE);
  refuseLinks();
  // The directories just created, outermost first: each one's entry lives in its parent, which is
  // flushed once the whole chain exists.
  for (const created of missing) (options.syncDirectory ?? syncDirectoryOnDisk)(dirname(created));
  // Every directory the caller declared it owns, not only the leaf. `mkdir` set the mode on what it
  // CREATED; a root an older version left at 0755 was created by nobody here and would keep it.
  for (const target of owned) {
    if (ownerOnlyGuarantee() === 'posix-mode') setMode(target, OWNER_ONLY_DIRECTORY_MODE);
    assertOwnerOnly(target, 'directory', options);
  }
}

/**
 * Seams for the durable write, injected for the same reason as {@link IOwnerOnlyIo}: a flush that
 * fails, or that runs in the wrong order, is a crash-time property no test can observe on a healthy
 * disk, so the order is asserted through these instead.
 */
export interface IOwnerOnlyDurability {
  /** Flush one open file's data and metadata to the device. */
  readonly syncFile?: (fileDescriptor: number) => void;
  /** Flush a directory's entries, so a rename inside it survives a crash. */
  readonly syncDirectory?: (directory: string) => void;
}

export interface IWriteOwnerOnlyFileOptions extends IOwnerOnlyDurability {
  /**
   * Flush the temp file before it is renamed over the target and the directory after, so a crash
   * leaves the old content or the new, never a renamed-but-empty file. Off by default: a plain
   * record is rewritten on the next save, whereas a key store has no other copy.
   */
  readonly durable?: boolean;
  /**
   * Only create: the temp file is linked into place, which fails with `EEXIST` if anything is at
   * the path by then, so two creators cannot both see "absent" and the second replace the first.
   */
  readonly createOnly?: boolean;
  /**
   * Runs once the temp file is complete, flushed and checked, immediately before it is put in place.
   * A throw leaves the target exactly as it was and removes the temp file, so a caller that guards a
   * write with a lock can check the lock is still its own as late as possible.
   */
  readonly beforeCommit?: () => void;
  /**
   * Where the temp file goes, beside the target; `<path>.<pid>.tmp` when omitted. A caller that
   * sweeps leftovers can give it a name that says whose it is.
   */
  readonly temporaryPath?: string;
  /** Seam for the hard link of `createOnly`, so a filesystem without hard links is reachable from a test. */
  readonly linkFile?: (existingPath: string, newPath: string) => void;
}

/**
 * The new content was put in place (renamed or linked) and a step after that failed — the directory
 * flush, or removing the temp name. The file holds the new content but its durability is not
 * confirmed; reporting this as a failed write would tell the caller the old content is still there.
 */
export class OwnerOnlyWriteUnconfirmedError extends Error {
  constructor(cause: unknown) {
    super('The new content is in place, but a step after putting it there failed.', { cause });
    this.name = 'OwnerOnlyWriteUnconfirmedError';
  }
}

/** `fsync` on a directory is POSIX; Windows cannot open one, and a few filesystems refuse the call. */
function syncDirectoryOnDisk(directory: string): void {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // allow-fallback: EINVAL/ENOTSUP mean the filesystem has no directory flush to offer.
    if (code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Replace `filePath` atomically with content only its owner can read. `content` is written as given:
 * text as UTF-8, bytes unchanged, so a sealed artifact goes through the same path as a plain record.
 *
 * The temp file carries the mode from the moment it is created — writing it at the umask's default
 * and tightening afterwards leaves a window in which the full content is world-readable on disk, and
 * `rename` preserves whatever mode the temp file had. The `chmod` after the write is for the case
 * where the temp path already existed at a wider mode.
 *
 * With `durable`, the temp file is flushed before the rename and the directory after it. Node
 * exposes `fsync(2)` only: on macOS that does not force the drive to empty its own write cache
 * (`F_FULLFSYNC`), so a power cut there can still lose the newest save.
 *
 * The mode is asserted on the temp file, before it is put in place; the rename or link keeps that
 * inode and its mode, so nothing about the mode is left to check afterwards. A failure before that
 * point leaves the target as it was; one after it is an {@link OwnerOnlyWriteUnconfirmedError}.
 */
export function writeOwnerOnlyFile(
  filePath: string,
  content: string | Uint8Array,
  options: IWriteOwnerOnlyFileOptions = {},
): void {
  ensureOwnerOnlyDirectory(
    dirname(filePath),
    options.durable === true ? { durable: true, syncDirectory: options.syncDirectory } : {},
  );
  const temporaryPath = options.temporaryPath ?? `${filePath}.${process.pid}.tmp`;
  writeOwnerOnlyTemporary(
    temporaryPath,
    content,
    options.durable === true ? (options.syncFile ?? fsyncSync) : undefined,
  );
  try {
    options.beforeCommit?.();
    if (options.createOnly === true) (options.linkFile ?? linkSync)(temporaryPath, filePath);
    else renameSync(temporaryPath, filePath);
  } catch (error) {
    removeTemporary(temporaryPath);
    throw error;
  }
  try {
    if (options.createOnly === true) unlinkSync(temporaryPath);
    if (options.durable === true) (options.syncDirectory ?? syncDirectoryOnDisk)(dirname(filePath));
  } catch (error) {
    throw new OwnerOnlyWriteUnconfirmedError(error);
  }
}

function removeTemporary(temporaryPath: string): void {
  try {
    unlinkSync(temporaryPath);
  } catch {
    // allow-fallback: the temp file may already be gone; the original error is the one to report.
  }
}

/**
 * Writes `content` to a temp file this call creates owner-only, flushed with `syncFile` when given,
 * and asserts its mode. A failure after the temp file was created removes it.
 */
function writeOwnerOnlyTemporary(
  temporaryPath: string,
  content: string | Uint8Array,
  syncFile: ((fileDescriptor: number) => void) | undefined,
): void {
  // A stale temp file is REMOVED rather than reused. It can only come from a process that died
  // mid-write, its contents are meaningless, and — the part that matters here — `writeFileSync` does
  // not apply `mode` to a file that already exists, so reusing one at 0666 would put the whole
  // record on disk world-readable before the rename.
  //
  // Removed with `force` rather than `if (exists) unlink`: checking and then acting on a path is a
  // race, and the race is exploitable here — another process can create the path between the two
  // calls, and the `wx` write below would then fail on a file this call believed it had cleared.
  // CodeQL flags the check-then-act form, rightly.
  rmSync(temporaryPath, { force: true });
  // `wx` guarantees this call CREATES the file, which is the only condition under which `mode` is
  // applied. There is deliberately no `chmod` after it: tightening a file that was created wide
  // leaves a window in which the full record is readable, and a `chmod` here would make the mode
  // above redundant — so a mutation that removed it would change nothing and the window would be
  // untested. The assertion below is what proves the mode actually took.
  const descriptor = openSync(temporaryPath, 'wx', OWNER_ONLY_FILE_MODE);
  try {
    try {
      writeFileSync(descriptor, content, 'utf8');
      syncFile?.(descriptor);
    } finally {
      closeSync(descriptor);
    }
    assertOwnerOnly(temporaryPath, 'file');
  } catch (error) {
    removeTemporary(temporaryPath);
    throw error;
  }
}

/** A complete, flushed owner-only temp file beside its target, which {@link IStagedOwnerOnlyFile.commit} puts in place. */
export interface IStagedOwnerOnlyFile {
  readonly temporaryPath: string;
  /**
   * Runs `beforeCommit`, renames the temp file over the target and flushes the directory. A throw
   * before the rename removes the temp file and leaves the target as it was; a failure after it is an
   * {@link OwnerOnlyWriteUnconfirmedError}.
   */
  commit(beforeCommit?: () => void): void;
  /** Removes the temp file if it was not put in place. Idempotent. */
  discard(): void;
}

/**
 * The first half of a durable {@link writeOwnerOnlyFile}: the content in an owner-only temp file
 * beside `filePath`, flushed, with the target untouched until `commit`. A caller replacing many files
 * stages every one before it renames any, so that no rename is published ahead of content it has not
 * yet flushed — on macOS, where the flush does not empty the drive's own cache, that ordering is most
 * of what a power cut leaves intact.
 */
export function stageOwnerOnlyFile(
  filePath: string,
  content: string | Uint8Array,
  options: IOwnerOnlyDurability & { readonly temporaryPath?: string } = {},
): IStagedOwnerOnlyFile {
  ensureOwnerOnlyDirectory(dirname(filePath), {
    durable: true,
    syncDirectory: options.syncDirectory,
  });
  const temporaryPath = options.temporaryPath ?? `${filePath}.${process.pid}.tmp`;
  writeOwnerOnlyTemporary(temporaryPath, content, options.syncFile ?? fsyncSync);
  let settled = false;
  return {
    temporaryPath,
    commit: (beforeCommit) => {
      if (settled) throw new Error('A staged owner-only file is committed or discarded only once.');
      settled = true;
      try {
        beforeCommit?.();
        renameSync(temporaryPath, filePath);
      } catch (error) {
        removeTemporary(temporaryPath);
        throw error;
      }
      try {
        (options.syncDirectory ?? syncDirectoryOnDisk)(dirname(filePath));
      } catch (error) {
        throw new OwnerOnlyWriteUnconfirmedError(error);
      }
    },
    discard: () => {
      if (settled) return;
      settled = true;
      removeTemporary(temporaryPath);
    },
  };
}

/**
 * Tighten a file that already exists — the repair path for a record an older version left at 0644.
 *
 * A no-op on a path that does not exist, because "there is nothing to tighten" and "we tightened it"
 * are the same outcome for the caller, and throwing would make every writer branch on existence.
 */
export function tightenExistingFile(filePath: string): void {
  if (ownerOnlyGuarantee() !== 'posix-mode') return;
  let mode: number;
  try {
    mode = statSync(filePath).mode & 0o7777;
  } catch {
    return; // allow-fallback: nothing to tighten
  }
  if ((mode & FORBIDDEN_BITS) === 0) return;
  chmodSync(filePath, OWNER_ONLY_FILE_MODE);
  assertOwnerOnly(filePath, 'file');
}
