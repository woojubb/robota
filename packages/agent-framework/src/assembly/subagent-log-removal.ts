/**
 * Removal of one parent session's subagent logs, `{baseLogsDir}/{parentSessionId}/subagents/`, when
 * that session is deleted. The logs sit under the user's log root, not in a project's state, so this
 * runs on every platform with plain path calls: every directory it enters is checked with `lstat` to
 * be a directory and not a link, and its resolved path must still be the one it walked down to, so a
 * link is never followed and nothing outside the parent's `subagents/` directory is touched. A link
 * or any other non-directory inside the tree, or at the session's own names (`{parentSessionId}` and
 * its `subagents`), is unlinked by name, never followed, so nothing planted there makes the session's
 * logs unremovable.
 */

import { lstatSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { isSafeSessionId } from '@robota-sdk/agent-session';

import { resolveSubagentLogDir } from './subagent-logger.js';

/** What a removal found: the logs were there and are gone, or there were none. */
export type TSubagentLogRemoval = 'removed' | 'absent';

/** A subagent log removal that stopped before touching anything it could not prove was its own. */
export class SubagentLogRemovalRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubagentLogRemovalRefusedError';
  }
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * `path` as a plain directory: `undefined` when nothing is there; refused when it is a link or not a
 * directory, or when it no longer resolves to itself (a directory above it was swapped for a link).
 */
function plainDirectory(path: string): { readonly dev: number; readonly ino: number } | undefined {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (metadata === undefined) return undefined;
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new SubagentLogRemovalRefusedError(
      'A subagent log directory is a link or not a directory, so it is not removed.',
    );
  }
  if (!samePath(realpathSync(path), path)) {
    throw new SubagentLogRemovalRefusedError(
      'A subagent log directory no longer resolves to where it was found, so it is not removed.',
    );
  }
  return { dev: metadata.dev, ino: metadata.ino };
}

/**
 * The session's own entry `path` under the plain directory `parent`: `'absent'`, `'directory'` (a
 * plain one), or `'unlinked'` when it was a link or any other non-directory, removed by name without
 * following it. Refused when `parent` no longer resolves to itself.
 */
function ownEntry(parent: string, path: string): 'absent' | 'directory' | 'unlinked' {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (metadata === undefined) return 'absent';
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    plainDirectory(path);
    return 'directory';
  }
  if (plainDirectory(parent) === undefined) return 'absent';
  unlinkName(path, metadata.isSymbolicLink());
  return 'unlinked';
}

/**
 * Unlinks the non-directory entry `path` by name. A directory link on Windows (a junction or
 * directory symlink) is removed with `rmdir`, which removes the link, never its target.
 */
function unlinkName(path: string, isLink: boolean): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (isMissing(error)) return;
    if (
      process.platform === 'win32' &&
      isLink &&
      (error as NodeJS.ErrnoException).code === 'EPERM'
    ) {
      rmdirSync(path);
      return;
    }
    throw error;
  }
}

function removeTree(directory: string): void {
  const before = plainDirectory(directory);
  if (before === undefined) return;
  const names = readdirSync(directory);
  const after = plainDirectory(directory);
  if (after === undefined) return;
  if (after.dev !== before.dev || after.ino !== before.ino) {
    throw new SubagentLogRemovalRefusedError(
      'A subagent log directory was replaced while it was being removed.',
    );
  }
  for (const name of names) {
    const entry = join(directory, name);
    const metadata = lstatSync(entry, { throwIfNoEntry: false });
    if (metadata === undefined) continue;
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      removeTree(entry);
      continue;
    }
    unlinkName(entry, metadata.isSymbolicLink());
  }
  try {
    rmdirSync(directory);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

/**
 * Removes `{baseLogsDir}/{parentSessionId}/subagents/` and everything under it, then the parent's own
 * directory if that is left empty; a link or other non-directory at the parent or `subagents` name is
 * unlinked by name instead, never followed. `parentSessionId` must be a session id (no separator,
 * never `..`), and `baseLogsDir` itself must be a directory, not a link (directories above it are
 * resolved once); otherwise nothing is removed and {@link SubagentLogRemovalRefusedError} is thrown.
 * `baseLogsDir` is the root the host's subagent loggers write under (its sealed-artifact root
 * included, when it keeps one), and nothing above it is touched.
 */
export function removeSubagentLogs(
  baseLogsDir: string,
  parentSessionId: string,
): TSubagentLogRemoval {
  if (!isSafeSessionId(parentSessionId)) {
    throw new SubagentLogRemovalRefusedError('The parent session id is not a usable session id.');
  }
  const rootMetadata = lstatSync(baseLogsDir, { throwIfNoEntry: false });
  if (rootMetadata === undefined) return 'absent';
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new SubagentLogRemovalRefusedError(
      'The subagent log root is a link or not a directory, so nothing under it is removed.',
    );
  }
  const root = realpathSync(baseLogsDir);
  if (plainDirectory(root) === undefined) return 'absent';
  const subagents = resolveSubagentLogDir(parentSessionId, root);
  const parent = join(root, parentSessionId);
  const parentEntry = ownEntry(root, parent);
  if (parentEntry !== 'directory') return parentEntry === 'unlinked' ? 'removed' : 'absent';
  const subagentsEntry = ownEntry(parent, subagents);
  if (subagentsEntry === 'directory') removeTree(subagents);
  const present = subagentsEntry !== 'absent';
  try {
    rmdirSync(parent);
  } catch {
    // allow-fallback: the parent directory holds something else, or is already gone; it stays.
  }
  return present ? 'removed' : 'absent';
}
