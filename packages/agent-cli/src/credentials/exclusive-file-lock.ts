/**
 * One holder at a time across processes, for work a credential store cannot make atomic on its own —
 * a keychain has no create-if-absent, so "generate a key unless one exists" needs a lock around it.
 *
 * The lock is a file created exclusively (`O_EXCL`) holding a random token that names its holder. A
 * lock older than `staleMs` was left by a process that died holding it and is taken over. Nothing is
 * removed by path alone: a lock is first renamed aside, and deleted only if the file set aside is the
 * very one that was judged; anything else is put back without replacing a lock created meanwhile.
 */
import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { ensureOwnerOnlyDirectory } from '@robota-sdk/agent-core/node';

import { CredentialStoreError } from './credential-store-error.js';

export interface IExclusiveFileLockOptions {
  readonly staleMs?: number;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 25;

/** Remove `path` only if, once set aside, it is still the lock `isExpected` describes. */
function removeIf(path: string, isExpected: (aside: string) => boolean): void {
  const aside = `${path}.${randomBytes(8).toString('hex')}.aside`;
  try {
    renameSync(path, aside);
  } catch {
    return; // allow-fallback: already gone — released or taken over by someone else.
  }
  let expected = false;
  try {
    expected = isExpected(aside);
  } catch {
    // allow-fallback: unreadable means unproven; it is put back, not removed.
  }
  if (!expected) {
    try {
      linkSync(aside, path);
    } catch {
      // allow-fallback: a newer lock already holds the name; it is never replaced.
    }
  }
  try {
    unlinkSync(aside);
  } catch {
    // allow-fallback: nothing more to clean up.
  }
}

function tryAcquire(path: string, token: string, staleMs: number): boolean {
  try {
    writeFileSync(path, token, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new CredentialStoreError(`lock ${path} could not be created`);
    }
  }
  let observed: { token: string; mtimeMs: number };
  try {
    observed = { token: readFileSync(path, 'utf8'), mtimeMs: statSync(path).mtimeMs };
  } catch {
    return false; // allow-fallback: released between the two calls; the next attempt decides.
  }
  if (Date.now() - observed.mtimeMs > staleMs) {
    removeIf(
      path,
      (aside) =>
        readFileSync(aside, 'utf8') === observed.token &&
        statSync(aside).mtimeMs === observed.mtimeMs,
    );
  }
  return false;
}

/** Run `critical` while no other holder of `path`, in this process or another, runs. */
export async function withExclusiveFileLock<T>(
  path: string,
  critical: () => Promise<T>,
  options: IExclusiveFileLockOptions = {},
): Promise<T> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  ensureOwnerOnlyDirectory(dirname(path));
  const token = randomBytes(16).toString('hex');
  while (!tryAcquire(path, token, staleMs)) {
    if (Date.now() >= deadline) {
      throw new CredentialStoreError(`timed out waiting for lock ${path}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  try {
    return await critical();
  } finally {
    removeIf(path, (aside) => readFileSync(aside, 'utf8') === token);
  }
}
