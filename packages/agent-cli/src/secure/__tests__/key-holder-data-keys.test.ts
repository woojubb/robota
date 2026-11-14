/**
 * The holder's cache of opened data keys: reading an append-only store costs one public-key
 * operation per writer epoch, not one per line, and locking still drops every way of reading.
 *
 * The keyring is wrapped in counting spies, so the cost is asserted as a number of key openings on
 * the two-epoch known-answer file. The cache is keyed by the exact sealed key and the binding it
 * authenticated under, filled only when the caller says the kind shares keys across an epoch, and it
 * remembers a sealed key that did not open — but never blames a good key for a damaged record.
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ArtifactCorruptError } from '@robota-sdk/agent-core';
import { KeyringError, openArtifactKey, openBlob, parseKeyring } from '@robota-sdk/agent-keyring';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyHolderArtifactSealer } from '@robota-sdk/agent-local-host';
import { KeyHolder, OpenedDataKeys } from '@robota-sdk/agent-local-host';
import { createMemoryKeyringStore } from './helpers.js';

import type { IArtifactContext } from '@robota-sdk/agent-core';

vi.mock('@robota-sdk/agent-keyring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-keyring')>();
  return {
    ...actual,
    openArtifactKey: vi.fn(actual.openArtifactKey),
    openBlob: vi.fn(actual.openBlob),
  };
});

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const FIXTURE_RECOVERY_KEY = 'M2GT-58X4-MPKA-FA59-NANT-SBDE-NYRB-3CNK';
const history: IArtifactContext = { kind: 'prompt-history-line', id: 'user' };
const SEALED_KEY_BYTES = 93;
/** Epoch of each line of the known-answer file, in file order (see sealed-prompt-history-vector.test.ts). */
const EPOCH_OF_LINE = ['A', 'B', 'A', 'A', 'B', 'B'] as const;

const keyring = parseKeyring(readFileSync(fixture('keyring-v1.json'), 'utf8'));
const lines = readFileSync(fixture('prompt-history-v1.sealed'), 'utf8')
  .split('\n')
  .filter((line) => line.length > 0);

const keyOpenings = vi.mocked(openArtifactKey);
const blobOpenings = vi.mocked(openBlob);

async function reader(): Promise<{ sealer: KeyHolderArtifactSealer; holder: KeyHolder }> {
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock({ type: 'recoveryKey', recoveryKey: FIXTURE_RECOVERY_KEY });
  return { sealer: new KeyHolderArtifactSealer(holder), holder };
}

/** `line` with one byte of its decoded blob flipped. */
function damaged(line: string, index: number): string {
  const blob = Buffer.from(line.slice('RSL1:'.length), 'base64url');
  blob[index] ^= 0x01;
  return `RSL1:${blob.toString('base64url')}`;
}

function openAll(sealer: KeyHolderArtifactSealer, all: readonly string[]): string[] {
  return all.map((line) => {
    try {
      return sealer.openLine(line, history);
    } catch (error) {
      return error instanceof ArtifactCorruptError ? 'corrupt' : 'other failure';
    }
  });
}

/** The data keys the spy saw opened, as the holder keeps them. */
function openedDataKeys(): Buffer[] {
  return keyOpenings.mock.results
    .filter((result) => result.type === 'return')
    .map((result) => result.value as Buffer);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('KeyHolder data keys — what reading costs', () => {
  it('opens a two-epoch file with one key opening per epoch, and none when reading it again', async () => {
    const { sealer } = await reader();
    expect(openAll(sealer, lines)).not.toContain('corrupt');
    expect(keyOpenings).toHaveBeenCalledTimes(2);
    expect(openAll(sealer, lines)).not.toContain('corrupt');
    expect(keyOpenings).toHaveBeenCalledTimes(2);
    expect(blobOpenings).not.toHaveBeenCalled();
  });

  it('pays for the epochs again after a lock and an unlock: locking forgot them', async () => {
    const { sealer, holder } = await reader();
    openAll(sealer, lines);
    holder.lock('explicit');
    await holder.unlock({ type: 'recoveryKey', recoveryKey: FIXTURE_RECOVERY_KEY });
    expect(openAll(sealer, lines)).not.toContain('corrupt');
    expect(keyOpenings).toHaveBeenCalledTimes(4);
  });

  it('opens whole artifacts afresh every time and keeps none of their keys', async () => {
    const { sealer } = await reader();
    const record: IArtifactContext = { kind: 'session-record', id: 'session_a' };
    const stored = sealer.sealBytes(Buffer.from('{"record":true}'), record);
    sealer.openBytes(stored, record);
    sealer.openBytes(stored, record);
    expect(blobOpenings).toHaveBeenCalledTimes(2);
    expect(keyOpenings).not.toHaveBeenCalled();
  });
});

describe('KeyHolder data keys — what does not open', () => {
  it('tries a damaged sealed key once, however often its line is read', async () => {
    const { sealer } = await reader();
    const withBadKey = [...lines, damaged(lines[0] as string, 40)];
    expect(openAll(sealer, withBadKey).at(-1)).toBe('corrupt');
    expect(keyOpenings).toHaveBeenCalledTimes(3);
    expect(openAll(sealer, withBadKey).at(-1)).toBe('corrupt');
    expect(keyOpenings).toHaveBeenCalledTimes(3);
  });

  it('does not let a damaged record under a good key stop the rest of its epoch', async () => {
    const { sealer } = await reader();
    // The damaged line is read first, so its epoch's key is first opened for a record that fails.
    const badRecord = damaged(lines[0] as string, SEALED_KEY_BYTES + 20);
    const results = openAll(sealer, [badRecord, ...lines.slice(1)]);
    expect(results[0]).toBe('corrupt');
    expect(results.slice(1)).not.toContain('corrupt');
    expect(EPOCH_OF_LINE.slice(1)).toContain('A');
    expect(keyOpenings).toHaveBeenCalledTimes(2);
  });
});

describe('KeyHolder data keys — wiped with the keys', () => {
  it('fills the cached data keys with zeros when it locks', async () => {
    const { sealer, holder } = await reader();
    openAll(sealer, lines);
    const cached = openedDataKeys();
    expect(cached).toHaveLength(2);
    expect(cached.every((key) => key.some((byte) => byte !== 0))).toBe(true);
    holder.lock('idle');
    expect(cached.every((key) => key.every((byte) => byte === 0))).toBe(true);
  });

  it('fills them with zeros when a second unlock installs new keys', async () => {
    const { sealer, holder } = await reader();
    openAll(sealer, lines);
    const cached = openedDataKeys();
    await holder.unlock({ type: 'recoveryKey', recoveryKey: FIXTURE_RECOVERY_KEY });
    expect(holder.isUnlocked).toBe(true);
    expect(cached.every((key) => key.every((byte) => byte === 0))).toBe(true);
    expect(openAll(sealer, lines)).not.toContain('corrupt');
    expect(keyOpenings).toHaveBeenCalledTimes(4);
  });
});

describe('OpenedDataKeys', () => {
  const aad = Buffer.from('robota/artifact/v1|session-log-line|s');
  const sealedKey = (fill: number): Buffer => Buffer.alloc(SEALED_KEY_BYTES, fill);
  const dataKey = (fill: number): Buffer => Buffer.alloc(32, fill);

  it('opens a sealed key once per binding and hands the same key back afterwards', () => {
    const cache = new OpenedDataKeys(4);
    const open = vi.fn(() => dataKey(1));
    const first = cache.open(aad, sealedKey(1), open);
    expect(cache.open(aad, sealedKey(1), open)).toBe(first);
    expect(open).toHaveBeenCalledTimes(1);
    // The same sealed key under another binding is another entry: it authenticated under other bytes.
    cache.open(Buffer.from('robota/artifact/v1|session-log-line|t'), sealedKey(1), open);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('remembers a sealed key that did not open, and only failures that describe the bytes', () => {
    const cache = new OpenedDataKeys(4);
    const refused = vi.fn((): Buffer => {
      throw new KeyringError('decryption-failed', 'Authentication of the ciphertext failed.');
    });
    for (let pass = 0; pass < 2; pass += 1) {
      expect(() => cache.open(aad, sealedKey(2), refused)).toThrow(KeyringError);
    }
    expect(refused).toHaveBeenCalledTimes(1);

    for (const failure of [
      new KeyringError('kdf-failed', 'The key derivation could not run on this host.'),
      new Error('not a keyring refusal'),
    ]) {
      const failing = vi.fn((): Buffer => {
        throw failure;
      });
      expect(() => cache.open(aad, sealedKey(3), failing)).toThrow(failure);
      expect(() => cache.open(aad, sealedKey(3), failing)).toThrow(failure);
      expect(failing).toHaveBeenCalledTimes(2);
    }
  });

  it('lets go of the least recently used entry beyond its limit and wipes its key', () => {
    const cache = new OpenedDataKeys(2);
    const one = cache.open(aad, sealedKey(1), () => dataKey(1));
    const two = cache.open(aad, sealedKey(2), () => dataKey(2));
    cache.open(aad, sealedKey(1), () => dataKey(9)); // used again
    cache.open(aad, sealedKey(3), () => dataKey(3));
    expect(two.every((byte) => byte === 0)).toBe(true);
    expect(one.every((byte) => byte === 1)).toBe(true);
    const reopen = vi.fn(() => dataKey(2));
    cache.open(aad, sealedKey(2), reopen);
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it('wipes every key it holds and forgets them all', () => {
    const cache = new OpenedDataKeys(4);
    const keys = [1, 2, 3].map((fill) => cache.open(aad, sealedKey(fill), () => dataKey(fill)));
    cache.wipe();
    expect(keys.every((key) => key.every((byte) => byte === 0))).toBe(true);
    const reopen = vi.fn(() => dataKey(1));
    cache.open(aad, sealedKey(1), reopen);
    expect(reopen).toHaveBeenCalledTimes(1);
  });
});
