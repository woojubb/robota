import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
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
