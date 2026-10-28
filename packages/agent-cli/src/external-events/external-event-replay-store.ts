import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import { ensureGuardedDirectory } from '@robota-sdk/agent-remote-pairing/local';
import {
  assertWindowsPrivatePath,
  createWindowsPrivateDirectory,
} from '../session-inventory/windows-security.js';

import type { IExternalEventTokenClaimStore } from '@robota-sdk/agent-framework';

const CLAIM_NAME = /^[0-9a-f]{64}\.claim$/u;
const MAX_CLAIMS = 4096;
const MAX_EXPIRY_BYTES = 32;

interface IExternalEventReplayStoreTestHooks {
  readonly afterExpiredClaimObserved?: (path: string) => void;
}

function ensurePrivateDirectory(directory: string): void {
  if (process.platform === 'win32') {
    createWindowsPrivateDirectory(directory);
    assertWindowsPrivatePath(directory, true);
    return;
  }
  const admission = ensureGuardedDirectory(directory, {
    expectedUid: process.getuid?.() ?? 0,
  });
  if (!admission.admitted) throw new Error('External event replay storage is not private.');
}

function readExpiry(path: string): number | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_EXPIRY_BYTES) return undefined;
    if (
      process.platform !== 'win32' &&
      (metadata.uid !== (process.getuid?.() ?? 0) || (metadata.mode & 0o077) !== 0)
    ) {
      return undefined;
    }
    const expiresAt = Number(readFileSync(descriptor, 'utf8').trim());
    return Number.isSafeInteger(expiresAt) && expiresAt > 0 ? expiresAt : undefined;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function liveClaimCount(
  directory: string,
  now: number,
  hooks: IExternalEventReplayStoreTestHooks,
): number {
  let live = 0;
  for (const name of readdirSync(directory)) {
    if (!CLAIM_NAME.test(name)) continue;
    const path = join(directory, name);
    const expiresAt = readExpiry(path);
    if (expiresAt !== undefined && expiresAt <= now) {
      hooks.afterExpiredClaimObserved?.(path);
      try {
        rmSync(path, { force: true });
        continue;
      } catch {
        // A claim that cannot be removed remains live, which fails closed at the capacity bound.
      }
    }
    live += 1;
  }
  return live;
}

function writeAll(descriptor: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
}

/**
 * Atomically claim verified token IDs across CLI processes. The directory and files are owner-only;
 * filenames hash issuer, resource, token ID and verified expiry, so an expired issuance can be
 * reclaimed without naming or deleting a newer issuance. No bearer or raw claim is persisted.
 */
export function createExternalEventReplayStore(
  userRoot: string,
  hooks: IExternalEventReplayStoreTestHooks = {},
): IExternalEventTokenClaimStore {
  const directory = join(userRoot, 'external-event-replay');
  ensurePrivateDirectory(directory);
  return {
    claim: ({ grant, jti, expiresAt, at }) => {
      if (
        !Number.isSafeInteger(expiresAt) ||
        !Number.isSafeInteger(at) ||
        expiresAt <= at
      ) {
        return 'unavailable';
      }
      let count: number;
      try {
        count = liveClaimCount(directory, at, hooks);
      } catch {
        return 'unavailable';
      }
      if (count >= MAX_CLAIMS) return 'saturated';
      const digest = createHash('sha256')
        .update(grant.verifier.issuer)
        .update('\0')
        .update(grant.verifier.resource)
        .update('\0')
        .update(jti)
        .update('\0')
        .update(String(expiresAt))
        .digest('hex');
      const path = join(directory, `${digest}.claim`);
      let descriptor: number | undefined;
      let created = false;
      try {
        descriptor = openSync(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        created = true;
        const metadata = fstatSync(descriptor);
        if (
          !metadata.isFile() ||
          (process.platform !== 'win32' &&
            (metadata.uid !== (process.getuid?.() ?? 0) || (metadata.mode & 0o077) !== 0))
        ) {
          return 'unavailable';
        }
        writeAll(descriptor, Buffer.from(`${expiresAt}\n`, 'utf8'));
        fsyncSync(descriptor);
        if (process.platform === 'win32') assertWindowsPrivatePath(path, false);
        return 'claimed';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'spent';
        return 'unavailable';
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
        if (created && readExpiry(path) === undefined) {
          try {
            rmSync(path, { force: true });
          } catch {
            // A malformed claim left behind can only make later admission fail closed.
          }
        }
      }
    },
  };
}
