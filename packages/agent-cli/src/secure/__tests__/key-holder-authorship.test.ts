/**
 * The holder's authorship tags: the one proof of who wrote a stored artifact, since
 * an artifact sealed to the public key opens for whoever sealed it. The tag is an HMAC under the
 * keyring's authorship key over `robota/authorship/v1|<kind>|<id>|<sha256 of the bytes>`, so it binds
 * the artifact's kind and id as well as its bytes, and only an unlocked holder makes or checks one.
 * The known answer pins that binding: the fixed master key the keyring's own vectors use, and one tag
 * cross-checked in Python (hmac, hashlib).
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KeyringError, parseKeyring } from '@robota-sdk/agent-keyring';
import { describe, expect, it } from 'vitest';

import { KeyHolder } from '../key-holder.js';
import { createMemoryKeyringStore } from './helpers.js';

const keyring = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);
const recoveryKey = {
  type: 'recoveryKey',
  recoveryKey: 'M2GT-58X4-MPKA-FA59-NANT-SBDE-NYRB-3CNK',
} as const;
const context = { kind: 'session-record', id: 'session_kat_v1' } as const;
const envelope = Buffer.from('{"schemaVersion":1,"record":"known answer"}');
/** HMAC-SHA256 under the fixed master key's authorship key of `robota/authorship/v1|session-record|session_kat_v1|<sha256 hex of envelope>`. */
const KNOWN_TAG_HEX = 'a878a0b17ae99fa5c05423d0217c1e210701cb3e67c9300bc538c3dce84213f0';

async function unlockedHolder(): Promise<KeyHolder> {
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock(recoveryKey);
  return holder;
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof KeyringError) return error.code;
    throw error;
  }
  throw new Error('expected a KeyringError');
}

describe('KeyHolder authorship tags', () => {
  it('tag the kind, id and bytes to the known answer', async () => {
    const holder = await unlockedHolder();
    expect(Buffer.from(holder.tagAuthorship(context, envelope)).toString('hex')).toBe(
      KNOWN_TAG_HEX,
    );
  });

  it('verify the tag they made, and fail for another id, kind, bytes or tag', async () => {
    const holder = await unlockedHolder();
    const tag = holder.tagAuthorship(context, envelope);
    const tampered = Buffer.from(tag);
    tampered[0] ^= 0x01;

    expect(holder.verifyAuthorship(context, envelope, tag)).toBe(true);
    expect(holder.verifyAuthorship({ ...context, id: 'session_other' }, envelope, tag)).toBe(false);
    expect(
      holder.verifyAuthorship({ kind: 'session-log-line', id: context.id }, envelope, tag),
    ).toBe(false);
    expect(holder.verifyAuthorship(context, Buffer.from(`${envelope} `), tag)).toBe(false);
    expect(holder.verifyAuthorship(context, envelope, tampered)).toBe(false);
  });

  it('are made and checked only while unlocked', async () => {
    const holder = await unlockedHolder();
    const tag = holder.tagAuthorship(context, envelope);
    holder.lock('explicit');

    expect(codeOf(() => holder.tagAuthorship(context, envelope))).toBe('keys-locked');
    expect(codeOf(() => holder.verifyAuthorship(context, envelope, tag))).toBe('keys-locked');
    const locked = new KeyHolder({ store: createMemoryKeyringStore(keyring) });
    expect(codeOf(() => locked.tagAuthorship(context, envelope))).toBe('keys-locked');
  });

  it('refuse a context that could blur the binding, as a caller bug', async () => {
    const holder = await unlockedHolder();
    for (const bad of [
      { kind: 'session-record', id: 'a|b' },
      { kind: 'session-record', id: '' },
      { kind: 'session|record', id: 'a' },
    ]) {
      expect(() => holder.tagAuthorship(bad as typeof context, envelope)).toThrow(RangeError);
    }
  });
});

describe('KeyHolder unlock listeners', () => {
  it('hear each unlock after the keys are in place, until they unsubscribe', async () => {
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    const heard: boolean[] = [];
    const stop = holder.onUnlock(() => {
      heard.push(holder.isUnlocked);
    });

    await holder.unlock(recoveryKey);
    holder.lock('explicit');
    await holder.unlock(recoveryKey);
    stop();
    holder.lock('explicit');
    await holder.unlock(recoveryKey);

    expect(heard).toEqual([true, true]);
  });

  it('are not called by an unlock that fails, and one that throws stops neither the unlock nor the others', async () => {
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    let heard = 0;
    holder.onUnlock(() => {
      throw new Error('a listener failed');
    });
    holder.onUnlock(() => {
      heard += 1;
    });

    await expect(
      holder.unlock({ type: 'passphrase', passphrase: 'not the passphrase' }),
    ).rejects.toThrow();
    expect(heard).toBe(0);
    await expect(holder.unlock(recoveryKey)).resolves.toEqual({ sealingKey: 'verified' });
    expect(heard).toBe(1);
    expect(holder.isUnlocked).toBe(true);
  });
});
