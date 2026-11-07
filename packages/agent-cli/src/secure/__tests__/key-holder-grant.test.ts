/**
 * How a served runtime comes to hold read keys: it has no terminal and no passphrase, so an owner
 * link hands it the read keys (a read grant) and the holder takes them. It must check the granted
 * sealing key against the keyring file the way an unlock does, but a runtime holds no attach key and
 * no credential, so it reports a file that disagrees and never rewrites it: repair stays with
 * `secure verify` at a terminal.
 */
import {
  KeyringError,
  createKeyring,
  unlockWithPassphrase,
  type IReadKeys,
} from '@robota-sdk/agent-keyring';
import { describe, expect, it } from 'vitest';

import { KeyHolder, type IKeyHolderTimer, type IKeyHolderTimers } from '../key-holder.js';
import {
  FIXTURE_PASSPHRASE,
  OTHER_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
  withSwappedSealingKey,
} from './helpers.js';

/** The read keys an owner link delivers: what an unlock with the owner's passphrase yields. */
async function grantedKeys(): Promise<IReadKeys> {
  const { keyring } = await fixtureKeyring();
  return unlockWithPassphrase(keyring, FIXTURE_PASSPHRASE);
}

function fakeTimers(): IKeyHolderTimers & { readonly armed: () => number } {
  let armed = 0;
  return {
    now: () => 1_000_000,
    setTimer(): IKeyHolderTimer {
      armed += 1;
      return { clear: () => undefined, unref: () => undefined };
    },
    armed: () => armed,
  };
}

describe('KeyHolder — taking a read grant', () => {
  it('opens the holder with the granted keys and reports the file agrees', async () => {
    const { keyring } = await fixtureKeyring();
    const store = createMemoryKeyringStore(keyring);
    const timers = fakeTimers();
    const holder = new KeyHolder({ store, timers });
    const unlocks: string[] = [];
    holder.onUnlock(() => unlocks.push('unlock'));
    const keys = await grantedKeys();

    expect(holder.unlockWithGrant(keys)).toBe('verified');

    expect(holder.isUnlocked).toBe(true);
    expect(unlocks).toEqual(['unlock']);
    expect(timers.armed()).toBe(1);
    expect(store.saves).toEqual([]);
    expect(Buffer.from(holder.verifiedSealingKey()!)).toEqual(Buffer.from(keys.sealing.publicKey));
    // The holder can tag what it vouches for, which only keys it holds can do.
    const context = { kind: 'session-record', id: 'session_grant' } as const;
    const tag = holder.tagAuthorship(context, Buffer.from('bytes'));
    expect(holder.verifyAuthorship(context, Buffer.from('bytes'), tag)).toBe(true);
  });

  it('reports a swapped sealing key in the file as a mismatch, leaves the file alone and seals to the granted key', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    other.unlocked.lock();
    const swapped = withSwappedSealingKey(keyring, other.keyring);
    const store = createMemoryKeyringStore(swapped);
    const holder = new KeyHolder({ store });
    let sealingKeyChanges = 0;
    holder.onSealingKeyChange(() => {
      sealingKeyChanges += 1;
    });
    const keys = await grantedKeys();

    expect(holder.unlockWithGrant(keys)).toBe('mismatch');

    expect(store.saves).toEqual([]);
    expect(store.current()).toBe(swapped);
    expect(holder.isUnlocked).toBe(true);
    expect(Buffer.from(holder.sealingPublicKey())).toEqual(Buffer.from(keys.sealing.publicKey));
    expect(sealingKeyChanges).toBe(1);
  });

  it('refuses when there is no keyring file to check the grant against', async () => {
    const holder = new KeyHolder({ store: createMemoryKeyringStore() });
    const keys = await grantedKeys();

    expect(() => holder.unlockWithGrant(keys)).toThrow(/keyring/iu);
    expect(holder.isUnlocked).toBe(false);
  });

  it('refuses keys that are already locked, and stays locked', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring) });
    const keys = await grantedKeys();
    keys.lock();

    expect(() => holder.unlockWithGrant(keys)).toThrow(KeyringError);
    expect(holder.isUnlocked).toBe(false);
  });

  it('replaces the keys of an earlier grant and locks them', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), timers: fakeTimers() });
    const first = await grantedKeys();
    const second = await grantedKeys();
    holder.unlockWithGrant(first);

    holder.unlockWithGrant(second);

    expect(first.locked).toBe(true);
    expect(second.locked).toBe(false);
    expect(holder.isUnlocked).toBe(true);
  });

  it('locks the granted keys when the holder locks', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring) });
    const keys = await grantedKeys();
    const reasons: string[] = [];
    holder.onLock((reason) => reasons.push(reason));
    holder.unlockWithGrant(keys);

    holder.lock('explicit');

    expect(keys.locked).toBe(true);
    expect(holder.isUnlocked).toBe(false);
    expect(reasons).toEqual(['explicit']);
  });
});
