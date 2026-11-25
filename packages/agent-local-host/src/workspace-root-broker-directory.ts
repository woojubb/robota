import { createHash } from 'node:crypto';
import { lstatSync, lutimesSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { Stats } from 'node:fs';

/** The endpoint file a broker binds inside its namespace directory. */
export const BROKER_SOCKET_NAME = 'broker.sock';
/** The process-operation lock a broker holds for its whole life; its file is `<name>.guard`. */
export const BROKER_LOCK_NAME = 'workspace-root-broker';
const BROKER_GUARD_FILE = `${BROKER_LOCK_NAME}.guard`;

/** One broker serves one user-state root; this names that root in endpoint and directory names. */
export function userRootNamespace(userRoot: string): string {
  return createHash('sha256').update(userRoot).digest('hex').slice(0, 24);
}

export function brokerNamespaceName(userRoot: string, owner: number): string {
  return `robota-root-${owner}-${userRootNamespace(userRoot)}`;
}

/** Exactly the names {@link brokerNamespaceName} makes for this owner; nothing else in a shared directory. */
export function isBrokerNamespaceName(name: string, owner: number): boolean {
  return new RegExp(`^robota-root-${owner}-[0-9a-f]{24}$`, 'u').test(name);
}

/** A real directory (never a link) that only its owner can enter. */
export function isOwnerPrivateDirectory(metadata: Stats, owner: number): boolean {
  return (
    metadata.isDirectory() &&
    !metadata.isSymbolicLink() &&
    metadata.uid === owner &&
    (metadata.mode & 0o077) === 0
  );
}

function lstatOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Claims the namespace directory a start is about to launch a broker in: it is created when missing, and
 * a directory a killed broker left behind is renewed to the age of a new one. A sweep treats a directory
 * younger than its age gate as one a broker may still be starting in, but a leftover keeps the age of its
 * last change, so without the renewal a concurrent start's sweep would remove it before the broker locks
 * it. An entry that is not an owner-private directory is refused and never touched.
 */
export function claimBrokerNamespaceDirectory(directory: string, owner: number): void {
  // A sweep that removes the directory between the check and the renewal leaves it missing; the next pass creates it.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(directory, { mode: 0o700 });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const existing = lstatOrUndefined(directory);
    if (existing === undefined) continue;
    if (!isOwnerPrivateDirectory(existing, owner)) {
      throw new Error('The workspace broker directory is not owner-private.');
    }
    try {
      const now = new Date();
      lutimesSync(directory, now, now);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('The workspace broker directory could not be claimed.');
}

/**
 * Removes a broker's namespace directory and the two entries a broker leaves in it. Nothing is removed
 * unless the name is exactly a namespace name of this owner, the directory is a real owner-private
 * directory, and every entry is an owner-owned guard file or socket; anything else is left alone.
 * The caller proves that no broker serves the directory (it holds the guard, or is that broker).
 */
export function removeBrokerNamespaceDirectory(directory: string, owner: number): boolean {
  if (process.platform === 'win32' || !isBrokerNamespaceName(basename(directory), owner))
    return false;
  const before = lstatOrUndefined(directory);
  if (before === undefined || !isOwnerPrivateDirectory(before, owner)) return false;
  const entries = readdirSync(directory);
  const removable: string[] = [];
  for (const name of entries) {
    const entry = lstatOrUndefined(join(directory, name));
    if (entry === undefined) continue;
    const expected =
      name === BROKER_GUARD_FILE ? entry.isFile() : name === BROKER_SOCKET_NAME && entry.isSocket();
    if (!expected || entry.uid !== owner) return false;
    removable.push(name);
  }
  const current = lstatOrUndefined(directory);
  if (current === undefined || current.dev !== before.dev || current.ino !== before.ino)
    return false;
  for (const name of removable) unlinkSync(join(directory, name));
  rmdirSync(directory);
  return true;
}
