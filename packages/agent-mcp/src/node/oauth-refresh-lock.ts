/**
 * The Node refresh lock: one holder per credential across processes sharing its directory.
 * A live or unidentifiable owner is never displaced; a provably exited owner can be recovered.
 */

import { randomBytes } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  classifyProcessOwner,
  ensureOwnerOnlyDirectory,
  readCurrentProcessIdentity,
} from '@robota-sdk/agent-core/node';

import { MCPOAuthError } from '../client/oauth/errors.js';
import { credentialKeyDigest } from './oauth-file-store.js';

import type { IProcessIdentity } from '@robota-sdk/agent-core/node';
import type { IMCPOAuthRefreshLock } from '../client/oauth/refresh-lock.js';

/** The filesystem operations used by the guard; a test can interleave a recovery. */
export interface IFileOAuthRefreshLockFs {
  createDirectory(path: string): void;
  removeDirectory(path: string): void;
  createExclusive(path: string, content: string): void;
  read(path: string): string;
  rename(from: string, to: string): void;
  unlink(path: string): void;
  /** @deprecated Age does not prove that an owner has exited. */
  mtimeMs(path: string): number;
  /** @deprecated Guard recovery does not link lock files. */
  link(from: string, to: string): void;
}

const NODE_FS: IFileOAuthRefreshLockFs = {
  createDirectory: (path) => mkdirSync(path, { mode: 0o700 }),
  removeDirectory: (path) => rmdirSync(path),
  createExclusive: (path, content) => writeFileSync(path, content, { flag: 'wx', mode: 0o600 }),
  read: (path) => readFileSync(path, 'utf8'),
  rename: (from, to) => renameSync(from, to),
  unlink: (path) => unlinkSync(path),
  mtimeMs: (path) => statSync(path).mtimeMs,
  link: (from, to) => linkSync(from, to),
};

export interface IFileOAuthRefreshLockOptions {
  /** @deprecated Age alone cannot establish that the lock holder has exited. */
  readonly staleMs?: number;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly fs?: Partial<IFileOAuthRefreshLockFs>;
}

interface IGuardOwner {
  readonly token: string;
  readonly identity: IProcessIdentity;
}

const OWNER_FILE = 'owner.json';
const TOKEN = /^[a-f0-9]{32}$/u;
const IDENTITY_FIELDS = ['startTime', 'bootId', 'pidNamespace', 'hostname', 'machineId'] as const;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_MS = 50;

function readOwner(fs: IFileOAuthRefreshLockFs, path: string): IGuardOwner | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.read(join(path, OWNER_FILE)));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const identity = record['identity'];
    if (
      typeof record['token'] !== 'string' ||
      !TOKEN.test(record['token']) ||
      typeof identity !== 'object' ||
      identity === null ||
      Array.isArray(identity)
    )
      return undefined;
    const values = identity as Record<string, unknown>;
    if (
      typeof values['pid'] !== 'number' ||
      !Number.isSafeInteger(values['pid']) ||
      values['pid'] <= 0
    )
      return undefined;
    if (
      IDENTITY_FIELDS.some((field) => {
        const value = values[field];
        return (
          value !== undefined &&
          (typeof value !== 'string' || value.length === 0 || value.length > 256)
        );
      })
    )
      return undefined;
    return { token: record['token'], identity: values as unknown as IProcessIdentity };
  } catch {
    return undefined;
  }
}

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
 * The fixed path is a non-empty directory. Older implementations treat a directory as unreadable
 * and cannot steal it by age. A recovered owner's non-empty tombstone remains in place so a delayed
 * second recovery cannot rename a newer holder over it. Unknown and legacy owners stay closed.
 */
export function createFileOAuthRefreshLock(
  directory: string,
  options: IFileOAuthRefreshLockOptions = {},
): IMCPOAuthRefreshLock {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const fs: IFileOAuthRefreshLockFs = { ...NODE_FS, ...options.fs };

  const tryAcquire = (path: string, owner: IGuardOwner): boolean => {
    try {
      fs.createDirectory(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new MCPOAuthError('store-failed');
      }
      const previous = readOwner(fs, path);
      if (previous !== undefined && classifyProcessOwner(previous.identity) === 'gone') {
        try {
          fs.rename(path, `${path}.${previous.token}.stale`);
        } catch {
          // A competing recovery or a replacement leaves the guard closed.
        }
      }
      return false;
    }
    try {
      fs.createExclusive(join(path, OWNER_FILE), JSON.stringify(owner));
    } catch {
      try {
        fs.removeDirectory(path);
      } catch {
        // An incomplete guard stays closed until offline recovery.
      }
      throw new MCPOAuthError('store-failed');
    }
    return true;
  };

  const release = (path: string, token: string): void => {
    if (readOwner(fs, path)?.token !== token) return;
    const retired = `${path}.${token}.released`;
    try {
      fs.rename(path, retired);
      if (readOwner(fs, retired)?.token !== token) return;
      fs.unlink(join(retired, OWNER_FILE));
      fs.removeDirectory(retired);
    } catch {
      // A guard that cannot be safely released stays closed or remains as a sidecar.
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
      const owner: IGuardOwner = {
        token: randomBytes(16).toString('hex'),
        identity: readCurrentProcessIdentity(),
      };
      const deadline = Date.now() + timeoutMs;
      let acquired = false;
      while (!acquired) {
        if (signal?.aborted === true) throw new MCPOAuthError('cancelled');
        acquired = tryAcquire(path, owner);
        if (!acquired) {
          if (Date.now() >= deadline) throw new MCPOAuthError('lock-timeout');
          await sleep(pollMs, signal);
        }
      }
      try {
        return await critical();
      } finally {
        release(path, owner.token);
      }
    },
  };
}
