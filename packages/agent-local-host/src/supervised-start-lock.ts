import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ensurePrivateDirectory, probeRegisteredPid as probePid, readOwnedFile,
  readRegisteredProcessStartTime as readProcessStartTime, verifyExistingDirectory,
} from './supervised-control-carrier.js';

export interface ISupervisedDaemonStartLockOptions {
  /** The product's command that removes a lock left behind; it is quoted in the refusal. */
  readonly removalHint: string;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

function daemonStartLockFile(workspace: string, root: string): string {
  const digest = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
  return join(root, `.daemon-${digest}.lock`);
}

/**
 * Who holds a daemon start lock: a live process, one that is gone, or nobody the file names.
 * `undefined` means the lock was released in the meantime.
 */
function readDaemonStartLockOwner(
  file: string,
): { readonly pid?: number; readonly state: 'live' | 'gone' | 'unknown' } | undefined {
  let content: string;
  try {
    content = readOwnedFile(file, {
      ownerOnly: false, refusal: 'Daemon start lock is not owned by this user.',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  // `<pid> <start time>`: a pid alone could name an unrelated process that reused it after the
  // owner died, which would keep the lock looking held for good.
  const match = /^([1-9][0-9]{0,9}) (\S.*)$/u.exec(content);
  if (match === null) return { state: 'unknown' };
  const pid = Number(match[1]);
  if (probePid(pid) === 'absent') return { pid, state: 'gone' };
  return { pid, state: readProcessStartTime(pid) === match[2] ? 'live' : 'gone' };
}

const unlockHint = (removalHint: string): string => `If no daemon start is running, remove it with: ${removalHint}`;

/**
 * Serialize a workspace's daemon start, so two starts never launch two daemons. The lock is a file
 * created exclusively in the private supervised directory, holding its owner's pid and process
 * start time. A live owner is waited for. A lock this start did not take is never removed here: one
 * left by a start that is gone refuses the start and quotes the product's `removalHint`, so
 * removing it is the user's call. Resolves to the release of this start's own lock.
 */
export async function acquireSupervisedDaemonStartLock(
  workspace: string,
  root: string,
  options: ISupervisedDaemonStartLockOptions,
): Promise<() => void> {
  ensurePrivateDirectory(root);
  const file = daemonStartLockFile(workspace, root);
  const startedAt = readProcessStartTime(process.pid);
  if (!startedAt) throw new Error('Unable to prove the daemon start process identity.');
  const owner = `${process.pid} ${startedAt}`;
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    try {
      writeFileSync(file, owner, { flag: 'wx', mode: 0o600 });
      return () => {
        try {
          if (readFileSync(file, 'utf8') === owner) rmSync(file, { force: true });
        } catch {
          // Already gone; nothing to release.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const holder = readDaemonStartLockOwner(file);
    if (holder?.state === 'gone') {
      throw new Error(
        `A daemon start lock left by process ${holder.pid}, which is no longer running, remains at ${file}. ${unlockHint(options.removalHint)}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Another daemon start is still running in ${workspace}, or its lock remains at ${file}. ${unlockHint(options.removalHint)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 100));
  }
}

/**
 * Remove this workspace's daemon start lock at the user's request, the removal the start's refusal
 * names. A lock whose owner is still running is kept, since that start is still in progress.
 */
export function removeSupervisedDaemonStartLock(
  workspace: string,
  root: string,
): { readonly outcome: 'removed' | 'none' } | { readonly outcome: 'held'; readonly pid: number } {
  try {
    verifyExistingDirectory(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { outcome: 'none' };
    throw error;
  }
  const file = daemonStartLockFile(workspace, root);
  const holder = readDaemonStartLockOwner(file);
  if (holder === undefined) return { outcome: 'none' };
  if (holder.state === 'live' && holder.pid !== undefined) return { outcome: 'held', pid: holder.pid };
  rmSync(file, { force: true });
  return { outcome: 'removed' };
}
