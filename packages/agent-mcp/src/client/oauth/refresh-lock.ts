/**
 * One refresh at a time per credential, across every process that shares the store.
 *
 * Two robota processes signed in to the same server share its stored refresh token. When an
 * authorization server rotates refresh tokens, the second of two concurrent refreshes presents a
 * token the first already spent and is answered `invalid_grant` — which would sign the user out.
 * So a refresh runs under this lock, and whoever holds it re-reads the store first: a token another
 * process refreshed while this one waited is used as it is.
 *
 * The lock is the caller's, not the store's: a store only keeps credentials, and the same lock
 * serves a store that is not a file at all.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureOwnerOnlyDirectory } from '@robota-sdk/agent-core/node';

import { MCPOAuthError } from './errors.js';
import { credentialKeyDigest } from './store.js';

import type { IMCPOAuthCredentialKey } from './store.js';

export interface IMCPOAuthRefreshLock {
  /** Run `critical` while no other holder, in this process or another, runs for the same key. */
  withLock<T>(
    key: IMCPOAuthCredentialKey,
    critical: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}

export interface IFileOAuthRefreshLockOptions {
  /** A lock older than this was left by a process that died holding it. */
  readonly staleMs?: number;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

const DEFAULT_STALE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_MS = 50;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) return reject(new MCPOAuthError('cancelled'));
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new MCPOAuthError('cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A lock file created exclusively (`wx`) beside the credentials, holding a random token so a holder
 * only ever removes its own lock. A lock whose file is older than `staleMs` is taken over.
 */
export function createFileOAuthRefreshLock(
  directory: string,
  options: IFileOAuthRefreshLockOptions = {},
): IMCPOAuthRefreshLock {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

  const tryAcquire = (path: string, token: string): boolean => {
    try {
      writeFileSync(path, token, { flag: 'wx', mode: 0o600 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new MCPOAuthError('store-failed');
      }
    }
    try {
      if (Date.now() - statSync(path).mtimeMs > staleMs) rmSync(path, { force: true });
    } catch {
      // allow-fallback: the holder released it between the two calls; the next attempt decides.
    }
    return false;
  };

  const release = (path: string, token: string): void => {
    try {
      if (readFileSync(path, 'utf8') === token) rmSync(path, { force: true });
    } catch {
      // allow-fallback: already gone — taken over as stale, or removed by its holder.
    }
  };

  return {
    withLock: async (key, critical, signal) => {
      try {
        ensureOwnerOnlyDirectory(directory);
      } catch {
        throw new MCPOAuthError('store-failed');
      }
      const path = join(directory, `${credentialKeyDigest(key)}.lock`);
      const token = randomBytes(16).toString('hex');
      const deadline = Date.now() + timeoutMs;
      while (!tryAcquire(path, token)) {
        if (Date.now() >= deadline) throw new MCPOAuthError('lock-timeout');
        await sleep(pollMs, signal);
      }
      try {
        return await critical();
      } finally {
        release(path, token);
      }
    },
  };
}
