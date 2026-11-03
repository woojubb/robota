/**
 * KeyHolderArtifactSealer over a REAL keyring and a REAL KeyHolder — the production implementation
 * of the artifact-sealer port. The stores that call it are tested against the agent-core double; this
 * is where the port's promises are shown to hold with the actual cryptography:
 *
 *   - sealing needs only the public key, so a holder that never unlocked (or has locked again) still
 *     writes, and a holder that has unlocked reads what it wrote;
 *   - opening says WHY it failed: locked keys and a bad artifact are different errors;
 *   - an artifact is bound to its kind and owner, so a copy at another path does not open;
 *   - no error, and no stored form, carries the plaintext.
 */
import { Buffer } from 'node:buffer';

import {
  ArtifactCorruptError,
  ArtifactLockedError,
  isArtifactCorruptError,
  isArtifactLockedError,
} from '@robota-sdk/agent-core';
import { createKeyring, type TKeyringCredential } from '@robota-sdk/agent-keyring';
import { describe, expect, it } from 'vitest';

import { KeyHolder } from '../key-holder.js';
import { KeyHolderArtifactSealer, SealingKeyUnavailableError } from '../artifact-sealer.js';
import {
  FIXTURE_PASSPHRASE,
  OTHER_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
} from './helpers.js';

import type { IArtifactContext } from '@robota-sdk/agent-core';

const passphrase: TKeyringCredential = { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE };
const CANARY = 'CANARY-b41d-the-conversation-text';
const context: IArtifactContext = { kind: 'session-record', id: 'session_abc' };

async function holderOnFixtureKeyring(): Promise<KeyHolder> {
  const { keyring } = await fixtureKeyring();
  return new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
}

async function unlockedSealer(): Promise<{ sealer: KeyHolderArtifactSealer; holder: KeyHolder }> {
  const holder = await holderOnFixtureKeyring();
  await holder.unlock(passphrase);
  return { sealer: new KeyHolderArtifactSealer(holder), holder };
}

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('KeyHolderArtifactSealer — bytes', () => {
  it('round-trips and frames the stored form with the magic', async () => {
    const { sealer } = await unlockedSealer();
    const stored = sealer.sealBytes(Buffer.from(CANARY), context);
    expect(Buffer.from(stored).subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(sealer.isSealedBytes(stored)).toBe(true);
    expect(Buffer.from(sealer.openBytes(stored, context)).toString('utf8')).toBe(CANARY);
  });

  it('puts nothing readable in the stored form, and two seals of equal plaintext differ', async () => {
    const { sealer } = await unlockedSealer();
    const first = Buffer.from(sealer.sealBytes(Buffer.from(CANARY), context));
    const second = Buffer.from(sealer.sealBytes(Buffer.from(CANARY), context));
    expect(first.includes(Buffer.from(CANARY))).toBe(false);
    expect(first.equals(second)).toBe(false);
  });

  it('seals an empty value and binary data', async () => {
    const { sealer } = await unlockedSealer();
    const binary = Uint8Array.from({ length: 256 }, (_, value) => value);
    expect(sealer.openBytes(sealer.sealBytes(new Uint8Array(0), context), context)).toHaveLength(0);
    expect(new Uint8Array(sealer.openBytes(sealer.sealBytes(binary, context), context))).toEqual(
      binary,
    );
  });

  it('does not take plain bytes for sealed ones', async () => {
    const { sealer } = await unlockedSealer();
    const plain = Buffer.from('{"schemaVersion":2}');
    expect(sealer.isSealedBytes(plain)).toBe(false);
    expect(thrown(() => sealer.openBytes(plain, context))).toBeInstanceOf(ArtifactCorruptError);
  });
});

describe('KeyHolderArtifactSealer — lines', () => {
  it('round-trips a line as one text line', async () => {
    const { sealer } = await unlockedSealer();
    const stored = sealer.sealLine(`${CANARY}\nsecond physical line`, context);
    expect(stored.startsWith('RSL1:')).toBe(true);
    expect(stored).not.toMatch(/[\r\n\s]/);
    expect(sealer.isSealedLine(stored)).toBe(true);
    expect(stored).not.toContain(CANARY);
    expect(sealer.openLine(stored, context)).toBe(`${CANARY}\nsecond physical line`);
  });

  it('seals equal lines to different text', async () => {
    const { sealer } = await unlockedSealer();
    expect(sealer.sealLine(CANARY, context)).not.toBe(sealer.sealLine(CANARY, context));
  });

  it('refuses a plain line, a non-canonical spelling and a damaged one as corrupt', async () => {
    const { sealer } = await unlockedSealer();
    const stored = sealer.sealLine(CANARY, context);
    const damaged = `${stored.slice(0, -2)}${stored.endsWith('A') ? 'B' : 'A'}${stored.slice(-1)}`;
    for (const bad of [
      '{"type":"line"}',
      `${stored}=`,
      `${stored} `,
      `RSL1:${stored.slice(5)}\n`,
      'RSL1:',
      damaged,
    ]) {
      expect(isArtifactCorruptError(thrown(() => sealer.openLine(bad, context)))).toBe(true);
    }
  });
});

describe('KeyHolderArtifactSealer — locked and unlocked', () => {
  it('seals with the public key alone before any unlock, and an unlocked holder reads it', async () => {
    const writer = new KeyHolderArtifactSealer(await holderOnFixtureKeyring());
    const stored = writer.sealBytes(Buffer.from(CANARY), context);
    const line = writer.sealLine(CANARY, context);
    expect(isArtifactLockedError(thrown(() => writer.openBytes(stored, context)))).toBe(true);

    const { sealer: reader } = await unlockedSealer();
    expect(Buffer.from(reader.openBytes(stored, context)).toString('utf8')).toBe(CANARY);
    expect(reader.openLine(line, context)).toBe(CANARY);
  });

  it('keeps sealing after a lock, throws ArtifactLockedError on open, and opens again after unlock', async () => {
    const { sealer, holder } = await unlockedSealer();
    const stored = sealer.sealBytes(Buffer.from(CANARY), context);

    holder.lock('explicit');
    const afterLock = sealer.sealBytes(Buffer.from(CANARY), context);
    const error = thrown(() => sealer.openBytes(stored, context));
    expect(error).toBeInstanceOf(ArtifactLockedError);
    expect((error as ArtifactLockedError).code).toBe('ARTIFACT_LOCKED');
    expect(
      isArtifactLockedError(thrown(() => sealer.openLine(sealer.sealLine('x', context), context))),
    ).toBe(true);

    await holder.unlock(passphrase);
    expect(Buffer.from(sealer.openBytes(stored, context)).toString('utf8')).toBe(CANARY);
    expect(Buffer.from(sealer.openBytes(afterLock, context)).toString('utf8')).toBe(CANARY);
  });

  it('reports locked for sealed input whatever its content, and corrupt for input that is not sealed', async () => {
    const { sealer, holder } = await unlockedSealer();
    const stored = Buffer.from(sealer.sealBytes(Buffer.from(CANARY), context));
    const flipped = Buffer.from(stored);
    flipped[60] ^= 0x01;
    holder.lock('explicit');
    expect(thrown(() => sealer.openBytes(flipped, context))).toBeInstanceOf(ArtifactLockedError);
    expect(thrown(() => sealer.openBytes(Buffer.from('plain'), context))).toBeInstanceOf(
      ArtifactCorruptError,
    );
  });

  it('reports corrupt while locked for a torn fragment or a layout this build does not write', async () => {
    const { sealer, holder } = await unlockedSealer();
    const stored = Buffer.from(sealer.sealBytes(Buffer.from(CANARY), context));
    const blob = stored.subarray(4);
    const otherVersion = Buffer.from(blob);
    otherVersion[0] = 0x02;
    const asLine = (bytes: Uint8Array): string =>
      `RSL1:${Buffer.from(bytes).toString('base64url')}`;
    holder.lock('explicit');
    for (const bad of [
      blob.subarray(0, 1),
      blob.subarray(0, 5),
      blob.subarray(0, 120),
      otherVersion,
    ]) {
      expect(
        thrown(() => sealer.openBytes(Buffer.concat([stored.subarray(0, 4), bad]), context)),
      ).toBeInstanceOf(ArtifactCorruptError);
      expect(thrown(() => sealer.openLine(asLine(bad), context))).toBeInstanceOf(
        ArtifactCorruptError,
      );
      // With a reusable kind too: the layout is checked before the cache or the keys.
      const line: IArtifactContext = { kind: 'session-log-line', id: context.id };
      expect(thrown(() => sealer.openLine(asLine(bad), line))).toBeInstanceOf(ArtifactCorruptError);
    }
  });

  it('calls a framing version it does not write sealed, and does not try to open it', async () => {
    const { sealer } = await unlockedSealer();
    const stored = Buffer.from(sealer.sealBytes(Buffer.from(CANARY), context));
    stored.write('RSL2', 0, 'ascii');
    const line = `RSL2${sealer.sealLine(CANARY, context).slice(4)}`;

    expect(sealer.isSealedBytes(stored)).toBe(true);
    expect(sealer.isSealedLine(line)).toBe(true);
    expect(thrown(() => sealer.openBytes(stored, context))).toBeInstanceOf(ArtifactCorruptError);
    expect(thrown(() => sealer.openLine(line, context))).toBeInstanceOf(ArtifactCorruptError);
  });
});

describe('KeyHolderArtifactSealer — what does not open', () => {
  it('refuses an artifact moved to another owner or read as another kind', async () => {
    const { sealer } = await unlockedSealer();
    const stored = sealer.sealBytes(Buffer.from(CANARY), context);
    const line = sealer.sealLine(CANARY, context);
    const otherOwner = { ...context, id: 'session_other' };
    const otherKind: IArtifactContext = { kind: 'checkpoint-manifest', id: context.id };
    for (const wrong of [otherOwner, otherKind]) {
      expect(thrown(() => sealer.openBytes(stored, wrong))).toBeInstanceOf(ArtifactCorruptError);
      expect(thrown(() => sealer.openLine(line, wrong))).toBeInstanceOf(ArtifactCorruptError);
    }
  });

  it('refuses a flipped bit anywhere in the blob, a truncation and an extension', async () => {
    const { sealer } = await unlockedSealer();
    const stored = Buffer.from(sealer.sealBytes(Buffer.from(CANARY), context));
    const cases: Buffer[] = [
      stored.subarray(0, stored.length - 1),
      Buffer.concat([stored, Buffer.from([0])]),
      stored.subarray(0, 4),
    ];
    for (const index of [4, 5, 40, 80, stored.length - 1]) {
      const flipped = Buffer.from(stored);
      flipped[index] ^= 0x01;
      cases.push(flipped);
    }
    for (const bad of cases) {
      expect(thrown(() => sealer.openBytes(bad, context))).toBeInstanceOf(ArtifactCorruptError);
    }
  });

  it('refuses an artifact sealed under another keyring', async () => {
    const { sealer } = await unlockedSealer();
    const { keyring, unlocked } = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    unlocked.lock();
    const otherHolder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    const stranger = new KeyHolderArtifactSealer(otherHolder);
    const stored = stranger.sealBytes(Buffer.from(CANARY), context);
    expect(thrown(() => sealer.openBytes(stored, context))).toBeInstanceOf(ArtifactCorruptError);
  });

  it('carries no plaintext, key or path in either error', async () => {
    const { sealer, holder } = await unlockedSealer();
    const stored = sealer.sealBytes(Buffer.from(CANARY), context);
    const corrupt = thrown(() => sealer.openBytes(stored, { ...context, id: 'session_other' }));
    holder.lock('explicit');
    const locked = thrown(() => sealer.openBytes(stored, context));
    for (const error of [corrupt, locked] as Error[]) {
      const everything = `${error.name} ${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`;
      expect(everything).not.toContain(CANARY);
      expect(everything).not.toContain('session_abc');
      expect(everything).not.toContain('session_other');
      expect(everything).not.toContain(FIXTURE_PASSPHRASE);
      expect(error.cause).toBeUndefined();
    }
  });
});

describe('KeyHolderArtifactSealer — the context', () => {
  it('refuses an id that could blur the binding, an empty id and an unknown kind', async () => {
    const { sealer } = await unlockedSealer();
    for (const bad of [
      { kind: 'session-record', id: 'a|b' },
      { kind: 'session-record', id: '' },
      { kind: 'session-record', id: 'x'.repeat(5000) },
      { kind: 'not-a-kind', id: 'a' },
    ] as unknown as IArtifactContext[]) {
      expect(thrown(() => sealer.sealBytes(Buffer.from('x'), bad))).toBeInstanceOf(RangeError);
      expect(thrown(() => sealer.sealLine('x', bad))).toBeInstanceOf(RangeError);
    }
  });

  it('accepts every artifact kind the port names', async () => {
    const { sealer } = await unlockedSealer();
    for (const kind of [
      'session-record',
      'prompt-history-line',
      'session-log-line',
      'session-log-payload',
      'checkpoint-manifest',
      'checkpoint-preimage',
      'tool-result-spill',
    ] as const) {
      const bound = { kind, id: 'owner-1' };
      expect(sealer.openLine(sealer.sealLine(kind, bound), bound)).toBe(kind);
    }
  });
});

describe('KeyHolderArtifactSealer — when the sealing key cannot be read', () => {
  it('fails with fixed text that names neither the keyring path nor the file', async () => {
    const store = createMemoryKeyringStore();
    const sealer = new KeyHolderArtifactSealer(new KeyHolder({ store, policy: { idleMs: 0 } }));
    const error = thrown(() => sealer.sealBytes(Buffer.from(CANARY), context)) as Error;
    const everything = `${error.name} ${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`;
    expect(everything).not.toContain(store.path);
    expect(everything).not.toContain('keyring.json');
    expect(everything).not.toContain(CANARY);
    expect(error.cause).toBeUndefined();
    expect(error).toBeInstanceOf(SealingKeyUnavailableError);
    expect((error as SealingKeyUnavailableError).reason).toBe('missing');
  });
});
