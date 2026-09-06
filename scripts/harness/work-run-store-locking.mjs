/**
 * The filesystem primitives `WorkRunStore` coordinates on: the per-branch pointer path, and the
 * mutual exclusion that makes a read-modify-write of one run's state atomic across processes.
 *
 * Its own module because these are the only parts of the store that reason about the LOCK DIRECTORY
 * and about waiting — they can time out and they can leave a lock behind, which the state
 * transitions around them never can. Splitting also keeps `work-run-store.mjs` inside the 300-line
 * anti-monolith limit (INFRA-181) — moved, never baselined at birth.
 *
 * Both names are re-exported from `work-run-store.mjs`, so no consumer changes.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { assertSafeOwnedParent, ensureOwnedDirectory, workRunLockPath } from './work-run-paths.mjs';

const LOCK_TIMEOUT_MS = 2_000;
const LOCK_WAIT_MS = 20;

/** A branch's stable file-name key: any branch name hashes to one safe path segment. */
export const branchKey = (branch) => createHash('sha256').update(branch).digest('hex');

/** Where a branch's pointer lives: one file per branch, named by a hash so any branch name is safe. */
export function workRunPointerPath(gitCommonDir, branch) {
  return path.join(gitCommonDir, 'robota-work-runs', 'branches', `${branchKey(branch)}.json`);
}

/**
 * Run `action` while holding the run's lock, and release it however `action` ends.
 *
 * The lock is a DIRECTORY: `mkdir` is atomic on every filesystem this runs on, so two processes
 * cannot both believe they hold it. A waiter blocks on `Atomics.wait` rather than spinning, and gives
 * up at the deadline with a named error — a lock that waited forever would look like a hang, not a
 * conflict.
 */
export function withWorkRunLock(gitCommonDir, lockDir, runId, action) {
  ensureOwnedDirectory(gitCommonDir, lockDir);
  const lock = workRunLockPath(lockDir, runId);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let acquired = false;
  while (!acquired) {
    try {
      assertSafeOwnedParent(gitCommonDir, lock);
      mkdirSync(lock);
      ensureOwnedDirectory(gitCommonDir, lock);
      acquired = true;
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) {
        throw new Error(`timed out acquiring work-run lock for ${runId}`);
      }
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
        0,
        0,
        LOCK_WAIT_MS,
      );
    }
  }
  try {
    return action();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
