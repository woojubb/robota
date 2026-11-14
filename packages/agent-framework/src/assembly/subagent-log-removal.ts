/**
 * Removal of one parent session's subagent logs, `{baseLogsDir}/{parentSessionId}/subagents/`, when
 * that session is deleted. The logs sit under the user's log root, not in a project's state, so this
 * runs on every platform with plain path calls: every directory it enters is checked with `lstat` to
 * be a directory and not a link, and its resolved path must still be the one it walked down to, so a
 * link is never followed and nothing outside the parent's `subagents/` directory is touched. A link
 * or any other non-directory inside the tree is unlinked by name, never followed.
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
    try {
      unlinkSync(entry);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  try {
    rmdirSync(directory);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

/**
 * Removes `{baseLogsDir}/{parentSessionId}/subagents/` and everything under it, then the parent's own
 * directory if that is left empty. `parentSessionId` must be a session id (no separator, never `..`),
 * and the parent and `subagents/` directories must be plain directories, not links; otherwise nothing
 * is removed and {@link SubagentLogRemovalRefusedError} is thrown. `baseLogsDir` is the root the
 * host's subagent loggers write under (its sealed-artifact root included, when it keeps one); it is
 * resolved once, and nothing above it is touched.
 */
export function removeSubagentLogs(
  baseLogsDir: string,
  parentSessionId: string,
): TSubagentLogRemoval {
  if (!isSafeSessionId(parentSessionId)) {
    throw new SubagentLogRemovalRefusedError('The parent session id is not a usable session id.');
  }
  let root: string;
  try {
    root = realpathSync(baseLogsDir);
  } catch (error) {
    if (isMissing(error)) return 'absent';
    throw error;
  }
  if (plainDirectory(root) === undefined) return 'absent';
  const subagents = resolveSubagentLogDir(parentSessionId, root);
  const parent = join(root, parentSessionId);
  if (plainDirectory(parent) === undefined) return 'absent';
  const present = plainDirectory(subagents) !== undefined;
  if (present) removeTree(subagents);
  try {
    rmdirSync(parent);
  } catch {
    // allow-fallback: the parent directory holds something else, or is already gone; it stays.
  }
  return present ? 'removed' : 'absent';
}
