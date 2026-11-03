/**
 * Writer epochs in the product sealer: what sealing an append-only store costs, and when an epoch
 * starts over.
 *
 * One public-key seal per appended line was measured too slow to read back (an ECDH per line), so a
 * sealer reuses one data key per context for the kinds whose policy says `writer-epoch`, sealing it
 * to the public key once. The keyring is wrapped in counting spies here, so the number of public-key
 * operations is asserted rather than inferred from timing. An epoch must never outlive the key it was
 * sealed to: once an unlock has verified a different key, the next line starts a new epoch sealed to
 * the verified one, whether the file was repaired or not. Nor does an epoch live at a lock outlive
 * it, since its data key reads every line of the epoch, or any epoch outlive the sealer's disposal.
 */
import { Buffer } from 'node:buffer';

import {
  ARTIFACT_KEY_REUSE,
  ArtifactCorruptError,
  SEALED_ARTIFACT_MAX_OVERHEAD_BYTES,
  isArtifactLockedError,
} from '@robota-sdk/agent-core';
import {
  createKeyring,
  generateArtifactKey,
  getSealingPublicKey,
  sealArtifactKey,
  sealBlob,
  type IKeyring,
  type TKeyringCredential,
} from '@robota-sdk/agent-keyring';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KeyHolderArtifactSealer,
  WRITER_EPOCH_LIMITS,
  WriteOnlyArtifactSealer,
  WriterEpochs,
  formatWriteGrant,
} from '../artifact-sealer.js';
import { KeyHolder, SealingKeyMismatchError } from '../key-holder.js';
import { KeyringStoreError } from '../keyring-store.js';
import {
  FIXTURE_PASSPHRASE,
  OTHER_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
  withSwappedSealingKey,
} from './helpers.js';

import type { IArtifactContext, TArtifactKind } from '@robota-sdk/agent-core';

vi.mock('@robota-sdk/agent-keyring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-keyring')>();
  return {
    ...actual,
    generateArtifactKey: vi.fn(actual.generateArtifactKey),
    sealArtifactKey: vi.fn(actual.sealArtifactKey),
    sealBlob: vi.fn(actual.sealBlob),
  };
});

const passphrase: TKeyringCredential = { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE };
const history: IArtifactContext = { kind: 'prompt-history-line', id: 'user' };
const log: IArtifactContext = { kind: 'session-log-line', id: 'session_a' };
const SEALED_KEY_BYTES = 93;

const sealedKeys = vi.mocked(sealArtifactKey);
const blobs = vi.mocked(sealBlob);
const dataKeys = vi.mocked(generateArtifactKey);

/** Every public-key operation sealing performed: an epoch's sealed key, or a whole fresh blob. */
function publicKeySeals(): number {
  return sealedKeys.mock.calls.length + blobs.mock.calls.length;
}

/** The public key each epoch's data key was sealed to, in order. */
function sealedToKeys(): string[] {
  return sealedKeys.mock.calls.map(([key]) => Buffer.from(key).toString('hex'));
}

/** The data keys made so far, as the sealer holds them (the spy returns the same buffers). */
function madeDataKeys(): Buffer[] {
  return dataKeys.mock.results.map((result) => result.value as Buffer);
}

function decoded(line: string): Buffer {
  return Buffer.from(line.slice('RSL1:'.length), 'base64url');
}

/** The sealed data key every line of one epoch starts with. */
function epochOf(line: string): string {
  return decoded(line).subarray(0, SEALED_KEY_BYTES).toString('hex');
}

function hexOf(key: Uint8Array): string {
  return Buffer.from(key).toString('hex');
}

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

async function strangerKeyring(): Promise<IKeyring> {
  const { keyring, unlocked } = await createKeyring({ passphrase: OTHER_PASSPHRASE });
  unlocked.lock();
  return keyring;
}

/** A reader over the owner's keys, in a holder of its own, so nothing it opens comes from a writer's state. */
async function ownerReader(): Promise<KeyHolderArtifactSealer> {
  const { keyring, recoveryKey } = await fixtureKeyring();
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock({ type: 'recoveryKey', recoveryKey });
  return new KeyHolderArtifactSealer(holder);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writer epochs — what sealing costs', () => {
  it('seals 10,000 lines of one context with one public-key seal and one read of the file', async () => {
    const { keyring } = await fixtureKeyring();
    const store = createMemoryKeyringStore(keyring);
    let loads = 0;
    const counting = {
      ...store,
      load: () => {
        loads += 1;
        return store.load();
      },
    };
    const sealer = new KeyHolderArtifactSealer(
      new KeyHolder({ store: counting, policy: { idleMs: 0 } }),
    );
    for (let index = 0; index < 10_000; index += 1) {
      sealer.sealLine(`{"text":"prompt ${index}"}\n`, history);
    }
    expect(sealedKeys).toHaveBeenCalledTimes(1);
    expect(blobs).not.toHaveBeenCalled();
    expect(loads).toBe(1);
  });

  it('keeps one epoch per context, however the writes interleave', async () => {
    const sealer = new KeyHolderArtifactSealer(
      new KeyHolder({ store: createMemoryKeyringStore((await fixtureKeyring()).keyring) }),
    );
    for (let index = 0; index < 100; index += 1) {
      sealer.sealLine(`history ${index}`, history);
      sealer.sealLine(`log ${index}`, log);
    }
    expect(publicKeySeals()).toBe(2);
  });

  it('follows the kind policy: writer-epoch kinds share a key, fresh kinds seal one per call', async () => {
    const sealer = new KeyHolderArtifactSealer(
      new KeyHolder({ store: createMemoryKeyringStore((await fixtureKeyring()).keyring) }),
    );
    for (const [kind, reuse] of Object.entries(ARTIFACT_KEY_REUSE) as Array<
      [TArtifactKind, 'writer-epoch' | 'fresh']
    >) {
      vi.clearAllMocks();
      const context = { kind, id: 'owner-1' };
      sealer.sealLine('one', context);
      sealer.sealBytes(Buffer.from('two'), context);
      sealer.sealLine('three', context);
      expect(publicKeySeals(), kind).toBe(reuse === 'writer-epoch' ? 1 : 3);
    }
  });

  it('shares an epoch between sealed bytes and sealed lines of one context', async () => {
    const sealer = new KeyHolderArtifactSealer(
      new KeyHolder({ store: createMemoryKeyringStore((await fixtureKeyring()).keyring) }),
    );
    const payload: IArtifactContext = { kind: 'session-log-payload', id: 'session_a' };
    const bytes = Buffer.from(sealer.sealBytes(Buffer.from('{"big":true}'), payload));
    const line = sealer.sealLine('{"big":false}', payload);
    expect(bytes.subarray(4, 4 + SEALED_KEY_BYTES).toString('hex')).toBe(epochOf(line));
  });

  it('ends every epoch when the keys lock, wiping the data keys then, and never opens with a writer key', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    await holder.unlock(passphrase);
    const sealer = new KeyHolderArtifactSealer(holder);
    const before = sealer.sealLine('before the lock', history);
    sealer.sealLine('another context', log);
    holder.lock('explicit');
    // Wiped by the lock itself, before anything is sealed again.
    expect(madeDataKeys()).toHaveLength(2);
    expect(madeDataKeys().every((key) => key.every((byte) => byte === 0))).toBe(true);

    const after = sealer.sealLine('after the lock', history);
    expect(epochOf(after)).not.toBe(epochOf(before));
    expect(sealedKeys).toHaveBeenCalledTimes(3);
    // The sealer holds the new epoch's data key, and still does not read its own line while locked.
    const error = thrown(() => sealer.openLine(after, history));
    expect(isArtifactLockedError(error)).toBe(true);
    expect((error as { reason?: unknown }).reason).toBe('locked');
    await holder.unlock(passphrase);
    expect(sealer.openLine(before, history)).toBe('before the lock');
    expect(sealer.openLine(after, history)).toBe('after the lock');
  });

  it('keeps an epoch begun while locked through the next unlock, and ends it at the lock after', async () => {
    const holder = new KeyHolder({
      store: createMemoryKeyringStore((await fixtureKeyring()).keyring),
      policy: { idleMs: 0 },
    });
    const sealer = new KeyHolderArtifactSealer(holder);
    const whileLocked = sealer.sealLine('while locked', history);
    // Locking a holder that is already locked is no lock, so the epoch goes on.
    holder.lock('explicit');
    await holder.unlock(passphrase);
    const afterUnlock = sealer.sealLine('after the unlock', history);

    expect(epochOf(afterUnlock)).toBe(epochOf(whileLocked));
    expect(madeDataKeys()).toHaveLength(1);
    expect(madeDataKeys()[0]?.some((byte) => byte !== 0)).toBe(true);
    holder.lock('explicit');
    expect(madeDataKeys()[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it('leaves no lock subscription and no data key behind once disposed, however often', async () => {
    const holder = new KeyHolder({
      store: createMemoryKeyringStore((await fixtureKeyring()).keyring),
      policy: { idleMs: 0 },
    });
    const subscribe = holder.onLock.bind(holder);
    let subscribed = 0;
    let unsubscribed = 0;
    holder.onLock = (listener) => {
      subscribed += 1;
      const unsubscribe = subscribe(listener);
      return () => {
        unsubscribed += 1;
        unsubscribe();
      };
    };
    const sealer = new KeyHolderArtifactSealer(holder);
    const before = sealer.sealLine('before disposal', history);

    sealer.dispose();
    sealer.dispose();

    expect([subscribed, unsubscribed]).toEqual([1, 1]);
    expect(madeDataKeys()).toHaveLength(1);
    expect(madeDataKeys()[0]?.every((byte) => byte === 0)).toBe(true);
    // Sealing still works, and keeps no data key: each line is sealed as a fresh kind's would be.
    vi.clearAllMocks();
    const after = [sealer.sealLine('after', history), sealer.sealLine('after again', history)];
    expect(blobs).toHaveBeenCalledTimes(2);
    expect(sealedKeys).not.toHaveBeenCalled();
    expect(new Set([epochOf(before), ...after.map(epochOf)]).size).toBe(3);
    await holder.unlock(passphrase);
    expect(after.map((line) => sealer.openLine(line, history))).toEqual(['after', 'after again']);
  });

  it('keeps the 64 most recently used contexts and starts over for one it let go', async () => {
    const sealer = new KeyHolderArtifactSealer(
      new KeyHolder({ store: createMemoryKeyringStore((await fixtureKeyring()).keyring) }),
    );
    const owner = (index: number): IArtifactContext => ({
      kind: 'session-log-line',
      id: `s${index}`,
    });
    for (let index = 0; index < 64; index += 1) sealer.sealLine('x', owner(index));
    sealer.sealLine('x', owner(0)); // most recently used again
    sealer.sealLine('x', owner(64)); // pushes out s1, the least recently used
    expect(sealedKeys).toHaveBeenCalledTimes(65);
    sealer.sealLine('x', owner(0));
    expect(sealedKeys).toHaveBeenCalledTimes(65);
    sealer.sealLine('x', owner(1));
    expect(sealedKeys).toHaveBeenCalledTimes(66);
    expect(madeDataKeys()[1]?.every((byte) => byte === 0)).toBe(true);
  });
});

describe('writer epochs — the limits', () => {
  const sealingPublicKey = async (): Promise<Uint8Array> =>
    Uint8Array.from(getSealingPublicKey((await fixtureKeyring()).keyring));

  it('stops an epoch at 2^24 records, far below the random-nonce bound', () => {
    expect(WRITER_EPOCH_LIMITS).toEqual({ contexts: 64, records: 2 ** 24 });
  });

  it('starts a new epoch once the record limit is reached, wiping the old data key', async () => {
    const key = await sealingPublicKey();
    const epochs = new WriterEpochs(
      { sealingPublicKey: () => key, verifiedSealingKey: () => undefined },
      { contexts: 4, records: 3 },
    );
    const aad = Buffer.from('robota/artifact/v1|session-log-line|s');
    const sealed = Array.from({ length: 4 }, () => epochs.seal(Buffer.from('x'), aad));
    expect(sealedKeys).toHaveBeenCalledTimes(2);
    expect(sealed[2]?.subarray(0, SEALED_KEY_BYTES)).toEqual(
      sealed[0]?.subarray(0, SEALED_KEY_BYTES),
    );
    expect(sealed[3]?.subarray(0, SEALED_KEY_BYTES)).not.toEqual(
      sealed[0]?.subarray(0, SEALED_KEY_BYTES),
    );
    expect(madeDataKeys()[0]?.every((byte) => byte === 0)).toBe(true);
    expect(madeDataKeys()[1]?.some((byte) => byte !== 0)).toBe(true);
  });

  it('lets go of the least recently used context, not the oldest, and wipes its key', async () => {
    const key = await sealingPublicKey();
    const epochs = new WriterEpochs(
      { sealingPublicKey: () => key, verifiedSealingKey: () => undefined },
      { contexts: 2, records: 100 },
    );
    const aad = (id: string): Buffer => Buffer.from(`robota/artifact/v1|session-log-line|${id}`);
    epochs.seal(Buffer.from('x'), aad('a'));
    epochs.seal(Buffer.from('x'), aad('b'));
    epochs.seal(Buffer.from('x'), aad('a'));
    epochs.seal(Buffer.from('x'), aad('c')); // lets go of b
    expect(madeDataKeys()[1]?.every((byte) => byte === 0)).toBe(true);
    expect(madeDataKeys()[0]?.some((byte) => byte !== 0)).toBe(true);
    epochs.seal(Buffer.from('x'), aad('a'));
    expect(sealedKeys).toHaveBeenCalledTimes(3);
  });
});

describe('writer epochs — rolling over to the verified key', () => {
  it('seals to the file key before any unlock, and keeps the epoch when the unlock verifies that key', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    const sealer = new KeyHolderArtifactSealer(holder);
    const first = sealer.sealLine('before the unlock', history);
    await holder.unlock(passphrase);
    const second = sealer.sealLine('after the unlock', history);
    expect(epochOf(second)).toBe(epochOf(first));
    expect(sealedToKeys()).toEqual([hexOf(getSealingPublicKey(keyring))]);
  });

  it('starts a new epoch sealed to the verified key after an unlock whose repair could not be written', async () => {
    const { keyring } = await fixtureKeyring();
    const stranger = await strangerKeyring();
    const store = createMemoryKeyringStore(withSwappedSealingKey(keyring, stranger));
    store.failSaves(new KeyringStoreError('write-failed', store.path, 'EROFS'));
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
    const sealer = new KeyHolderArtifactSealer(holder);

    const planted = sealer.sealLine('sealed to the planted key', history);
    await expect(holder.unlock(passphrase)).rejects.toBeInstanceOf(SealingKeyMismatchError);
    expect(holder.isUnlocked).toBe(false);
    const verified = sealer.sealLine('sealed to the verified key', history);

    expect(sealedToKeys()).toEqual([
      hexOf(getSealingPublicKey(stranger)),
      hexOf(getSealingPublicKey(keyring)),
    ]);
    expect(epochOf(verified)).not.toBe(epochOf(planted));
    expect(madeDataKeys()[0]?.every((byte) => byte === 0)).toBe(true);
    const reader = await ownerReader();
    expect(reader.openLine(verified, history)).toBe('sealed to the verified key');
    expect(thrown(() => reader.openLine(planted, history))).toBeInstanceOf(ArtifactCorruptError);
  });

  it('starts a new epoch sealed to the verified key after a repaired unlock', async () => {
    const { keyring } = await fixtureKeyring();
    const stranger = await strangerKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(withSwappedSealingKey(keyring, stranger)),
      policy: { idleMs: 0 },
    });
    const sealer = new KeyHolderArtifactSealer(holder);

    const planted = sealer.sealLine('sealed to the planted key', log);
    await expect(holder.unlock(passphrase)).resolves.toEqual({ sealingKey: 'repaired' });
    const verified = sealer.sealLine('sealed to the verified key', log);

    expect(sealedToKeys()).toEqual([
      hexOf(getSealingPublicKey(stranger)),
      hexOf(getSealingPublicKey(keyring)),
    ]);
    expect(epochOf(verified)).not.toBe(epochOf(planted));
    expect(sealer.openLine(verified, log)).toBe('sealed to the verified key');
  });

  it('rolls a write-only sealer over when its grant is replaced, and not when the key is the same', async () => {
    const { keyring } = await fixtureKeyring();
    const stranger = await strangerKeyring();
    const sealer = new WriteOnlyArtifactSealer(formatWriteGrant(getSealingPublicKey(stranger)));

    const first = sealer.sealLine('to the first grant', history);
    sealer.replaceGrant(formatWriteGrant(getSealingPublicKey(stranger)));
    const same = sealer.sealLine('to the same key again', history);
    sealer.replaceGrant(formatWriteGrant(getSealingPublicKey(keyring)));
    const verified = sealer.sealLine('to the owner key', history);

    expect(epochOf(same)).toBe(epochOf(first));
    expect(epochOf(verified)).not.toBe(epochOf(first));
    expect(sealedToKeys()).toEqual([
      hexOf(getSealingPublicKey(stranger)),
      hexOf(getSealingPublicKey(keyring)),
    ]);
    expect(madeDataKeys()[0]?.every((byte) => byte === 0)).toBe(true);
    expect(sealer.writeGrant()).toBe(formatWriteGrant(getSealingPublicKey(keyring)));
    expect((await ownerReader()).openLine(verified, history)).toBe('to the owner key');
  });
});

describe('writer epochs — what the lines look like', () => {
  it('lines of one epoch share their first 93 decoded bytes; other epochs and sealers do not', async () => {
    const store = createMemoryKeyringStore((await fixtureKeyring()).keyring);
    const one = new KeyHolderArtifactSealer(new KeyHolder({ store }));
    const other = new KeyHolderArtifactSealer(new KeyHolder({ store }));
    const lines = ['a', 'b', 'c'].map((text) => one.sealLine(text, history));
    const sameSealerOtherContext = one.sealLine('a', { ...history, id: 'someone-else' });
    const otherSealer = other.sealLine('a', history);

    expect(new Set(lines.map(epochOf)).size).toBe(1);
    expect(new Set(lines.map((line) => decoded(line).toString('hex'))).size).toBe(3);
    expect(epochOf(sameSealerOtherContext)).not.toBe(epochOf(lines[0] as string));
    expect(epochOf(otherSealer)).not.toBe(epochOf(lines[0] as string));
  });

  it('opens every line on its own, in any order', async () => {
    const store = createMemoryKeyringStore((await fixtureKeyring()).keyring);
    const writers = [
      new KeyHolderArtifactSealer(new KeyHolder({ store })),
      new KeyHolderArtifactSealer(new KeyHolder({ store })),
    ];
    const written: Array<{ line: string; text: string; context: IArtifactContext }> = [];
    for (let index = 0; index < 8; index += 1) {
      const context = index % 3 === 0 ? log : history;
      const text = `{"text":"line ${index}"}\n`;
      written.push({
        line: (writers[index % 2] as KeyHolderArtifactSealer).sealLine(text, context),
        text,
        context,
      });
    }
    for (const { line, text, context } of [...written].reverse()) {
      expect((await ownerReader()).openLine(line, context)).toBe(text);
    }
    const reader = await ownerReader();
    for (const index of [5, 0, 7, 2, 1, 6, 3, 4]) {
      const { line, text, context } = written[index] as (typeof written)[number];
      expect(reader.openLine(line, context)).toBe(text);
    }
  });

  it('adds exactly 126 bytes to any plaintext, whatever the kind, under the bound', async () => {
    const sealer = new KeyHolderArtifactSealer(
      new KeyHolder({ store: createMemoryKeyringStore((await fixtureKeyring()).keyring) }),
    );
    for (const kind of Object.keys(ARTIFACT_KEY_REUSE) as TArtifactKind[]) {
      for (const size of [0, 1, 1000]) {
        const overhead = sealer.sealBytes(new Uint8Array(size), { kind, id: 'o' }).length - size;
        expect(overhead, `${kind} ${size}`).toBe(126);
        expect(overhead).toBeLessThan(SEALED_ARTIFACT_MAX_OVERHEAD_BYTES);
      }
    }
  });
});
