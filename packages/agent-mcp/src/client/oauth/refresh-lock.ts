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
import { linkSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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

/** The file operations the lock uses; a test replaces one to interleave two holders exactly. */
export interface IFileOAuthRefreshLockFs {
  /** Create `path` holding `content`, failing with `EEXIST` when it exists. */
  createExclusive(path: string, content: string): void;
  read(path: string): string;
  mtimeMs(path: string): number;
  rename(from: string, to: string): void;
  /** Create `to` as another name of `from`, failing with `EEXIST` when `to` exists. */
  link(from: string, to: string): void;
  unlink(path: string): void;
}

const NODE_FS: IFileOAuthRefreshLockFs = {
  createExclusive: (path, content) => writeFileSync(path, content, { flag: 'wx', mode: 0o600 }),
  read: (path) => readFileSync(path, 'utf8'),
  mtimeMs: (path) => statSync(path).mtimeMs,
  rename: (from, to) => renameSync(from, to),
  link: (from, to) => linkSync(from, to),
  unlink: (path) => unlinkSync(path),
};

export interface IFileOAuthRefreshLockOptions {
  /** A lock older than this was left by a process that died holding it. */
  readonly staleMs?: number;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly fs?: Partial<IFileOAuthRefreshLockFs>;
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
 * A lock file created exclusively beside the credentials, holding a random token that names its
 * holder. A lock older than `staleMs` was left by a process that died holding it and is taken over.
 *
 * Nothing removes a lock by path alone: between judging a lock and removing it, another process may
 * have replaced it with a fresh one of its own, and deleting that would let two refreshes run. So a
 * lock is first renamed aside — which no one else can then touch — and removed only when the file
 * set aside is the very one judged (same token and time for a takeover, the holder's own token for
 * a release). Anything else is put back under its name without replacing a lock created meanwhile.
 */
export function createFileOAuthRefreshLock(
  directory: string,
  options: IFileOAuthRefreshLockOptions = {},
): IMCPOAuthRefreshLock {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const fs: IFileOAuthRefreshLockFs = { ...NODE_FS, ...options.fs };

  /** Remove `path` only if, once set aside, it is still the lock `isExpected` describes. */
  const removeIf = (path: string, isExpected: (aside: string) => boolean): void => {
    const aside = `${path}.${randomBytes(8).toString('hex')}.aside`;
    try {
      fs.rename(path, aside);
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
        fs.link(aside, path);
      } catch {
        // allow-fallback: a newer lock already holds the name; it is never replaced.
      }
    }
    try {
      fs.unlink(aside);
    } catch {
      // allow-fallback: nothing more to clean up.
    }
  };

  const tryAcquire = (path: string, token: string): boolean => {
    try {
      fs.createExclusive(path, token);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new MCPOAuthError('store-failed');
      }
    }
    let observed: { token: string; mtimeMs: number };
    try {
      observed = { token: fs.read(path), mtimeMs: fs.mtimeMs(path) };
    } catch {
      return false; // allow-fallback: released between the two calls; the next attempt decides.
    }
    if (Date.now() - observed.mtimeMs > staleMs) {
      removeIf(
        path,
        (aside) => fs.read(aside) === observed.token && fs.mtimeMs(aside) === observed.mtimeMs,
      );
    }
    return false;
  };

  const release = (path: string, token: string): void => {
    try {
      // Cheap first look: a lock that is not ours is never even moved.
      if (fs.read(path) !== token) return;
    } catch {
      return; // allow-fallback: already gone — taken over as stale.
    }
    removeIf(path, (aside) => fs.read(aside) === token);
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
