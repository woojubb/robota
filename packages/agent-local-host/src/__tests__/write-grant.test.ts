/**
 * Write grants: how the product hands its sealing to another process (a subagent child) without
 * handing it a secret. A grant is the sealing public key and nothing else, so the process holding it
 * seals exactly as the parent does and can open nothing — and says it holds no keys, rather than that
 * they are locked, because no unlock in that process would ever read what it wrote.
 */
import { Buffer } from 'node:buffer';

import {
  ArtifactCorruptError,
  isArtifactLockedError,
  type IArtifactContext,
} from '@robota-sdk/agent-core';
import { getSealingPublicKey, type TKeyringCredential } from '@robota-sdk/agent-keyring';
import { describe, expect, it } from 'vitest';

import {
  KeyHolderArtifactSealer,
  SealingKeyUnavailableError,
  WriteOnlyArtifactSealer,
  formatWriteGrant,
  parseWriteGrant,
} from '../artifact-sealer.js';
import { KeyHolder } from '../key-holder.js';
import { FIXTURE_PASSPHRASE, createMemoryKeyringStore, fixtureKeyring } from '../testing.js';

const passphrase: TKeyringCredential = { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE };
const CANARY = 'CANARY-77e2-what-the-child-wrote';
const history: IArtifactContext = { kind: 'prompt-history-line', id: 'user' };
const record: IArtifactContext = { kind: 'session-record', id: 'session_fork' };
const GRANT_ERROR = 'The write grant is not one this build issues.';

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

async function ownerSealer(): Promise<{ sealer: KeyHolderArtifactSealer; holder: KeyHolder }> {
  const { keyring } = await fixtureKeyring();
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock(passphrase);
  return { sealer: new KeyHolderArtifactSealer(holder), holder };
}

describe('write grant format', () => {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index * 7);

  it('is `rsg1.` and the canonical unpadded base64url of the 32-byte key, and parses back', () => {
    const grant = formatWriteGrant(key);
    expect(grant).toBe(`rsg1.${Buffer.from(key).toString('base64url')}`);
    expect(grant).toMatch(/^rsg1\.[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(parseWriteGrant(grant))).toEqual(Buffer.from(key));
  });

  it('refuses any other prefix, a non-canonical spelling and a wrong length, in fixed text', () => {
    const encoded = Buffer.from(key).toString('base64url');
    const last = encoded.at(-1) as string;
    // The last character carries two unused bits, zero when canonical; setting one decodes the same.
    const sibling = String.fromCharCode(last.charCodeAt(0) + 1);
    expect(Buffer.from(`${encoded.slice(0, -1)}${sibling}`, 'base64url')).toEqual(Buffer.from(key));
    for (const bad of [
      '',
      encoded,
      `rsg2.${encoded}`,
      `RSG1.${encoded}`,
      `rsg1:${encoded}`,
      ` rsg1.${encoded}`,
      `rsg1.${encoded} `,
      `rsg1.${encoded}=`,
      `rsg1.${encoded.slice(0, -1)}+`,
      `rsg1.${encoded.slice(0, -1)}${sibling}`,
      `rsg1.${Buffer.from(key.subarray(0, 31)).toString('base64url')}`,
      `rsg1.${Buffer.concat([Buffer.from(key), Buffer.from([0])]).toString('base64url')}`,
    ]) {
      const error = thrown(() => parseWriteGrant(bad));
      expect(error, bad).toBeInstanceOf(RangeError);
      expect((error as Error).message).toBe(GRANT_ERROR);
    }
    expect(() => formatWriteGrant(key.subarray(0, 31))).toThrow(RangeError);
  });
});

describe('KeyHolderArtifactSealer.writeGrant', () => {
  it('names the key the sealer itself seals to: the file key before an unlock, the verified one after', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    const sealer = new KeyHolderArtifactSealer(holder);
    expect(sealer.writeGrant()).toBe(formatWriteGrant(getSealingPublicKey(keyring)));
    await holder.unlock(passphrase);
    expect(sealer.writeGrant()).toBe(formatWriteGrant(getSealingPublicKey(keyring)));
  });

  it('fails as sealing does when the key cannot be read, naming no path', () => {
    const store = createMemoryKeyringStore();
    const sealer = new KeyHolderArtifactSealer(new KeyHolder({ store, policy: { idleMs: 0 } }));
    const error = thrown(() => sealer.writeGrant()) as Error;
    expect(error).toBeInstanceOf(SealingKeyUnavailableError);
    expect((error as SealingKeyUnavailableError).reason).toBe('missing');
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(store.path);
  });
});

describe('WriteOnlyArtifactSealer', () => {
  it('seals lines and whole artifacts that the owner opens', async () => {
    const { sealer: owner } = await ownerSealer();
    const child = new WriteOnlyArtifactSealer(owner.writeGrant());
    const line = child.sealLine(CANARY, history);
    const bytes = child.sealBytes(Buffer.from(CANARY), record);
    expect(line).not.toContain(CANARY);
    expect(owner.openLine(line, history)).toBe(CANARY);
    expect(Buffer.from(owner.openBytes(bytes, record)).toString('utf8')).toBe(CANARY);
    expect(child.isSealedLine(line)).toBe(true);
    expect(child.isSealedBytes(bytes)).toBe(true);
  });

  it('opens nothing, and says it holds no keys', async () => {
    const { sealer: owner } = await ownerSealer();
    const child = new WriteOnlyArtifactSealer(owner.writeGrant());
    for (const open of [
      () => child.openLine(child.sealLine(CANARY, history), history),
      () => child.openBytes(child.sealBytes(Buffer.from(CANARY), record), record),
      () => child.openLine(owner.sealLine(CANARY, history), history),
    ]) {
      const error = thrown(open) as Error;
      expect(isArtifactLockedError(error)).toBe(true);
      expect((error as { reason?: unknown }).reason).toBe('no-keys');
      expect(`${error.message} ${error.stack ?? ''}`).not.toContain(CANARY);
    }
  });

  it('still tells input that is not sealed from sealed input it cannot open', async () => {
    const { sealer: owner } = await ownerSealer();
    const child = new WriteOnlyArtifactSealer(owner.writeGrant());
    expect(thrown(() => child.openLine('{"text":"plain"}', history))).toBeInstanceOf(
      ArtifactCorruptError,
    );
    expect(thrown(() => child.openBytes(Buffer.from('{"plain":1}'), record))).toBeInstanceOf(
      ArtifactCorruptError,
    );
    // A torn fragment is not an intact record held for someone else.
    const torn = child.sealLine(CANARY, history).slice(0, 45); // 30 whole bytes: canonical
    expect(thrown(() => child.openLine(torn, history))).toBeInstanceOf(ArtifactCorruptError);
  });

  it('refuses a context that could blur the binding, as the owner sealer does', async () => {
    const { sealer: owner } = await ownerSealer();
    const child = new WriteOnlyArtifactSealer(owner.writeGrant());
    for (const bad of [
      { kind: 'session-record', id: 'a|b' },
      { kind: 'not-a-kind', id: 'a' },
    ] as unknown as IArtifactContext[]) {
      expect(thrown(() => child.sealLine('x', bad))).toBeInstanceOf(RangeError);
    }
  });

  it('hands on the grant it seals to, and refuses a malformed one', async () => {
    const { sealer: owner } = await ownerSealer();
    const grant = owner.writeGrant();
    const child = new WriteOnlyArtifactSealer(grant);
    expect(child.writeGrant()).toBe(grant);
    expect(() => new WriteOnlyArtifactSealer('rsg1.not-a-key')).toThrow(RangeError);
    expect(() => child.replaceGrant('rsg9.x')).toThrow(RangeError);
    expect(child.writeGrant()).toBe(grant);
  });
});
