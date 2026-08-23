/**
 * SEC-020 (issue #2021) — creating a host directory or file that only its owner can read.
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
  mkdirSync,
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
   * one level up, on the very path it exists to protect. Found in review of PR #2224.
   *
   * It is a parameter rather than a walk up to some inferred boundary because WHICH ancestors belong
   * to the caller is the caller's knowledge. This module must not guess that a parent is ours; it
   * would eventually chmod someone's home directory.
   */
  readonly withinRoot?: string;
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
  makeDirectory(directory, OWNER_ONLY_DIRECTORY_MODE);
  // Every directory the caller declared it owns, not only the leaf. `mkdir` set the mode on what it
  // CREATED; a root an older version left at 0755 was created by nobody here and would keep it.
  const owned =
    options.withinRoot === undefined
      ? [directory]
      : segmentsFromRoot(options.withinRoot, directory);
  for (const target of owned) {
    if (ownerOnlyGuarantee() === 'posix-mode') setMode(target, OWNER_ONLY_DIRECTORY_MODE);
    assertOwnerOnly(target, 'directory', options);
  }
}

/**
 * Replace `filePath` atomically with content only its owner can read.
 *
 * The temp file carries the mode from the moment it is created — writing it at the umask's default
 * and tightening afterwards leaves a window in which the full content is world-readable on disk, and
 * `rename` preserves whatever mode the temp file had. The `chmod` after the write is for the case
 * where the temp path already existed at a wider mode.
 */
export function writeOwnerOnlyFile(filePath: string, content: string): void {
  ensureOwnerOnlyDirectory(dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  // A stale temp file is REMOVED rather than reused. It can only come from a process that died
  // mid-write, its contents are meaningless, and — the part that matters here — `writeFileSync` does
  // not apply `mode` to a file that already exists, so reusing one at 0666 would put the whole
  // record on disk world-readable before the rename.
  //
  // Removed with `force` rather than `if (exists) unlink`: checking and then acting on a path is a
  // race, and the race is exploitable here — another process can create the path between the two
  // calls, and the `wx` write below would then fail on a file this call believed it had cleared.
  // CodeQL flagged the check-then-act form on PR #2224 and it was right to.
  rmSync(temporaryPath, { force: true });
  // `wx` guarantees this call CREATES the file, which is the only condition under which `mode` is
  // applied. There is deliberately no `chmod` after it: tightening a file that was created wide
  // leaves a window in which the full record is readable, and a `chmod` here would make the mode
  // above redundant — so a mutation that removed it would change nothing and the window would be
  // untested. The assertion below is what proves the mode actually took.
  writeFileSync(temporaryPath, content, {
    encoding: 'utf8',
    mode: OWNER_ONLY_FILE_MODE,
    flag: 'wx',
  });
  try {
    assertOwnerOnly(temporaryPath, 'file');
    renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // allow-fallback: the temp file may already be gone; the original error is the one to report.
    }
    throw error;
  }
  assertOwnerOnly(filePath, 'file');
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
