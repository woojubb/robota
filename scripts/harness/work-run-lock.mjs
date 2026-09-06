import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { assertSafeOwnedParent, ensureOwnedDirectory, workRunLockPath } from './work-run-paths.mjs';

const LOCK_TIMEOUT_MS = 2_000;
const LOCK_WAIT_MS = 20;

/** Serialize one work-run mutation with an owner-checked, directory-based lock. */
export function withWorkRunLock({ gitCommonDir, runId, action }) {
  const lockDir = path.join(gitCommonDir, 'robota-work-runs', 'locks');
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
