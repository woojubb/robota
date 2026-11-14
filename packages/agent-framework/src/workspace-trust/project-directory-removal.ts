import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';

import { refuseProjectRead } from './project-reader-path.js';

import type { IWorkspaceDirectoryRemovalOptions, TWorkspaceDirectoryRemoval } from './types.js';

/**
 * Reads the mount id of an open descriptor. A bind mount keeps the device number of the tree it
 * shows, so only the mount id tells that a directory belongs to another mount.
 */
export type TMountIdReader = (descriptor: number) => string;

/** Removals (an unlink or an `rmdir`, attempted) one call makes when the caller names no budget. */
export const DEFAULT_REMOVAL_MAX_ENTRIES = 10_000;
/**
 * Time one call may spend when the caller names no budget, well under the workspace broker's
 * per-request timeout so a brokered removal always answers.
 */
export const DEFAULT_REMOVAL_MAX_MS = 2_000;
/** The largest budget a caller may ask for; anything above it could outlive a brokered request. */
const MAX_REMOVAL_ENTRIES = 100_000;
const MAX_REMOVAL_MS = 5_000;
/** Each level holds one descriptor open; a tree deeper than this is refused instead of running out. */
const MAX_REMOVAL_DEPTH = 256;

export function descriptorPath(descriptor: number, segment?: string): string {
  const root = `/proc/self/fd/${descriptor}`;
  return segment === undefined ? root : `${root}/${segment}`;
}

export function directoryOpenFlags(): number {
  return (
    constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0) |
    (constants.O_DIRECTORY ?? 0)
  );
}

/** The mount id Linux reports for an open descriptor; readable in a non-dumpable process too. */
export function readProcMountId(descriptor: number): string {
  const info = readFileSync(`/proc/self/fdinfo/${descriptor}`, 'utf8');
  const match = /^mnt_id:\s*(\d+)\s*$/mu.exec(info);
  if (match?.[1] === undefined) refuseProjectRead('The mount of a project directory is unknown.');
  return match[1];
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function budgetOf(options: IWorkspaceDirectoryRemovalOptions | undefined): {
  readonly maxEntries: number;
  readonly maxMs: number;
} {
  const maxEntries = options?.maxEntries ?? DEFAULT_REMOVAL_MAX_ENTRIES;
  const maxMs = options?.maxMs ?? DEFAULT_REMOVAL_MAX_MS;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_REMOVAL_ENTRIES) {
    refuseProjectRead('A directory removal needs an entry budget between 1 and 100000.');
  }
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > MAX_REMOVAL_MS) {
    refuseProjectRead('A directory removal needs a time budget between 1 and 5000 ms.');
  }
  return { maxEntries, maxMs };
}

/** A directory held open while its entries are removed, with the identity it had when opened. */
interface IPinnedDirectory {
  readonly descriptor: number;
  /** The pinned directory the name below is an entry of. */
  readonly parent: number;
  readonly name: string;
  readonly dev: bigint;
  readonly ino: bigint;
  entries: string[] | undefined;
  next: number;
}

type TOpened =
  | { readonly kind: 'directory'; readonly descriptor: number }
  | { readonly kind: 'other' }
  | { readonly kind: 'missing' };

/**
 * Opens `name` of the pinned `parent` as a directory without following a link. The open itself says
 * what the entry is: a link fails with `ELOOP` and every other non-directory with `ENOTDIR`, before
 * anything is opened, so a socket, FIFO or device is never opened and a dirent type is never needed.
 */
function openEntry(parent: number, name: string): TOpened {
  try {
    return {
      kind: 'directory',
      descriptor: openSync(descriptorPath(parent, name), directoryOpenFlags()),
    };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return { kind: 'missing' };
    if (code === 'ELOOP' || code === 'ENOTDIR') return { kind: 'other' };
    throw error;
  }
}

/**
 * Removes the directory `name` of the pinned `parent` and everything under it, within one mount and
 * one budget. Every directory is reached from a descriptor chain that starts at `parent`; no path
 * string is resolved twice. A directory on another mount than `parent` (a bind or tmpfs mount, even
 * one with the same device number) is refused before anything under it is touched; a non-directory
 * entry is unlinked by name, never followed or opened; a directory is removed only when empty and
 * only while its name still opens the directory that was emptied, so a replacement swapped in under
 * that name is refused, not removed.
 *
 * Containment is absolute; the identity of the last name is best-effort: between that recheck and
 * `rmdir` a same-user process can still swap in another empty directory of the same pinned parent,
 * which the kernel then removes. Nothing outside the pinned tree is reachable that way.
 */
export function removePinnedDirectory(
  parent: number,
  name: string,
  options: IWorkspaceDirectoryRemovalOptions | undefined,
  readMountId: TMountIdReader,
): TWorkspaceDirectoryRemoval {
  const budget = budgetOf(options);
  const started = performance.now();
  // Removals attempted so far. Every call makes at least one, so a retry always gets further.
  let attempts = 0;
  const exhausted = (): boolean =>
    attempts > 0 && (attempts >= budget.maxEntries || performance.now() - started >= budget.maxMs);

  const mount = readMountId(parent);
  const target = openEntry(parent, name);
  if (target.kind === 'missing') return { status: 'absent' };
  if (target.kind === 'other') {
    refuseProjectRead('Project directory removal requires a plain, non-link directory target.');
  }
  const stack: IPinnedDirectory[] = [];
  const pin = (descriptor: number, from: number, entry: string, dev?: bigint): IPinnedDirectory => {
    let pinned: IPinnedDirectory | undefined;
    try {
      const metadata = fstatSync(descriptor, { bigint: true });
      if (!metadata.isDirectory()) refuseProjectRead('A project directory is not a directory.');
      if (readMountId(descriptor) !== mount || (dev !== undefined && metadata.dev !== dev)) {
        refuseProjectRead('Project directory removal does not cross into another mount.');
      }
      pinned = {
        descriptor,
        parent: from,
        name: entry,
        dev: metadata.dev,
        ino: metadata.ino,
        entries: undefined,
        next: 0,
      };
      return pinned;
    } finally {
      if (pinned === undefined) closeSync(descriptor);
    }
  };

  try {
    stack.push(pin(target.descriptor, parent, name));
    const rootDevice = stack[0]!.dev;
    while (stack.length > 0) {
      const current = stack[stack.length - 1]!;
      current.entries ??= readdirSync(descriptorPath(current.descriptor));
      if (current.next < current.entries.length) {
        if (exhausted()) return { status: 'partial', reason: 'budget' };
        const entry = current.entries[current.next]!;
        const opened = openEntry(current.descriptor, entry);
        if (opened.kind === 'directory') {
          current.next += 1;
          if (stack.length >= MAX_REMOVAL_DEPTH) {
            closeSync(opened.descriptor);
            refuseProjectRead('A project directory is nested too deeply to remove.');
          }
          stack.push(pin(opened.descriptor, current.descriptor, entry, rootDevice));
          continue;
        }
        if (opened.kind === 'other') attempts += 1;
        if (opened.kind === 'other' && !unlinkEntry(current.descriptor, entry)) {
          // A directory took the name after the open said otherwise: visit the name again.
          continue;
        }
        current.next += 1;
        continue;
      }
      if (exhausted()) return { status: 'partial', reason: 'budget' };
      attempts += 1;
      if (!removeIfStillNamed(current)) return { status: 'partial', reason: 'concurrent' };
      stack.pop();
      closeSync(current.descriptor);
      syncDirectory(current.parent);
    }
    return { status: 'removed' };
  } finally {
    for (const pinned of stack.reverse()) closeSync(pinned.descriptor);
  }
}

/** Unlinks a non-directory entry by name; false when the name now holds a directory. */
function unlinkEntry(parent: number, entry: string): boolean {
  try {
    unlinkSync(descriptorPath(parent, entry));
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return true;
    if (code === 'EISDIR') return false;
    if (code === 'EBUSY')
      refuseProjectRead('Project directory removal does not remove a mount point.');
    throw error;
  }
}

/**
 * Removes the emptied, pinned directory by its name only while that name still opens the same
 * directory. False when it is not empty any more: a concurrent writer created an entry, and a later
 * call can finish.
 */
function removeIfStillNamed(pinned: IPinnedDirectory): boolean {
  const named = openEntry(pinned.parent, pinned.name);
  if (named.kind === 'missing') return true;
  if (named.kind === 'other') {
    refuseProjectRead('A project directory was replaced during its removal.');
  }
  try {
    const metadata = fstatSync(named.descriptor, { bigint: true });
    if (metadata.dev !== pinned.dev || metadata.ino !== pinned.ino) {
      refuseProjectRead('A project directory was replaced during its removal.');
    }
  } finally {
    closeSync(named.descriptor);
  }
  try {
    rmdirSync(descriptorPath(pinned.parent, pinned.name));
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return true;
    if (code === 'ENOTEMPTY' || code === 'EEXIST') return false;
    if (code === 'EBUSY')
      refuseProjectRead('Project directory removal does not remove a mount point.');
    throw error;
  }
}

/** `fsync` of a directory is POSIX; a few filesystems refuse the call. */
export function syncDirectory(directoryDescriptor: number): void {
  try {
    fsyncSync(directoryDescriptor);
  } catch (error) {
    const code = errorCode(error);
    // allow-fallback: EINVAL/ENOTSUP mean the filesystem has no directory flush to offer.
    if (code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
  }
}
