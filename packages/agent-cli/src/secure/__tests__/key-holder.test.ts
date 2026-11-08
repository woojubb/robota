import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KeyringError,
  createKeyring,
  fingerprint,
  getSealingPublicKey,
  sealBlob,
  serializeKeyring,
  type IKeyring,
  type TKeyringCredential,
} from '@robota-sdk/agent-keyring';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IDLE_LOCK_MS,
  KeyHolder,
  SealingKeyMismatchError,
  createNodeTimers,
  type IKeyHolderTimer,
  type IKeyHolderTimers,
  type TLockReason,
} from '../key-holder.js';
import { KeyringStoreError, createKeyringFileStore } from '@robota-sdk/agent-local-host';
import {
  FIXTURE_PASSPHRASE,
  OTHER_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
  withSwappedSealingKey,
} from './helpers.js';

const MINUTE = 60_000;
const passphrase: TKeyringCredential = { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE };

/** A clock and timers the test advances by hand; every timer records whether it was unref'd. */
function fakeTimers(): IKeyHolderTimers & {
  advance(ms: number): void;
  readonly created: Array<{ dueAt: number; unrefCalls: number; cleared: boolean; fired: boolean }>;
  pending(): number;
} {
  let now = 1_000_000;
  const created: Array<{
    dueAt: number;
    unrefCalls: number;
    cleared: boolean;
    fired: boolean;
    callback: () => void;
  }> = [];
  return {
    created,
    now: () => now,
    setTimer(callback, delayMs): IKeyHolderTimer {
      const record = {
        dueAt: now + delayMs,
        unrefCalls: 0,
        cleared: false,
        fired: false,
        callback,
      };
      created.push(record);
      return {
        clear: () => {
          record.cleared = true;
        },
        unref: () => {
          record.unrefCalls += 1;
        },
      };
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = created
          .filter((timer) => !timer.cleared && !timer.fired && timer.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt)[0];
        if (due === undefined) break;
        now = due.dueAt;
        due.fired = true;
        due.callback();
      }
      now = target;
    },
    pending: () => created.filter((timer) => !timer.cleared && !timer.fired).length,
  };
}

/** A keyring with a sealing key of its own, standing for the key an attacker would plant. */
async function strangerKeyring(): Promise<{ keyring: IKeyring }> {
  const { keyring, unlocked } = await createKeyring({ passphrase: OTHER_PASSPHRASE });
  unlocked.lock();
  return { keyring };
}

async function unlockedHolder(idleMs?: number): Promise<{
  holder: KeyHolder;
  timers: ReturnType<typeof fakeTimers>;
  store: ReturnType<typeof createMemoryKeyringStore>;
  reasons: TLockReason[];
}> {
  const { keyring } = await fixtureKeyring();
  const store = createMemoryKeyringStore(keyring);
  const timers = fakeTimers();
  const holder = new KeyHolder({
    store,
    timers,
    ...(idleMs === undefined ? {} : { policy: { idleMs } }),
  });
  const reasons: TLockReason[] = [];
  holder.onLock((reason) => reasons.push(reason));
  await holder.unlock(passphrase);
  return { holder, timers, store, reasons };
}

describe('KeyHolder — locking on inactivity', () => {
  it('locks after the idle period, 15 minutes by default', async () => {
    const { holder, timers, reasons } = await unlockedHolder();
    expect(DEFAULT_IDLE_LOCK_MS).toBe(15 * MINUTE);

    timers.advance(15 * MINUTE - 1);
    expect(holder.isUnlocked).toBe(true);
    timers.advance(1);
    expect(holder.isUnlocked).toBe(false);
    expect(reasons).toEqual(['idle']);
  });

  it('counts the idle period from the last touch', async () => {
    const { holder, timers, reasons } = await unlockedHolder(10 * MINUTE);

    timers.advance(9 * MINUTE);
    holder.touch();
    timers.advance(9 * MINUTE);
    expect(holder.isUnlocked).toBe(true);
    timers.advance(MINUTE);
    expect(holder.isUnlocked).toBe(false);
    expect(reasons).toEqual(['idle']);
  });

  it('never sets a timer when the idle lock is disabled', async () => {
    const { holder, timers } = await unlockedHolder(0);
    expect(timers.created).toHaveLength(0);
    timers.advance(24 * 60 * MINUTE);
    expect(holder.isUnlocked).toBe(true);
  });

  it('unrefs every timer it sets, so a pending lock never keeps the process alive', async () => {
    const { holder, timers } = await unlockedHolder(10 * MINUTE);
    timers.advance(5 * MINUTE);
    holder.touch();
    timers.advance(6 * MINUTE); // the first timer fires, finds activity, and sets another
    expect(timers.created.length).toBeGreaterThanOrEqual(2);
    for (const timer of timers.created) expect(timer.unrefCalls).toBe(1);
  });

  it('locks when the clock jumps backwards, since how long it has been is then unknown', async () => {
    const { holder } = await unlockedHolder(10 * MINUTE);
    let now = 5_000_000;
    let fire: (() => void) | undefined;
    const store = createMemoryKeyringStore((await fixtureKeyring()).keyring);
    const backwards = new KeyHolder({
      store,
      policy: { idleMs: 10 * MINUTE },
      timers: {
        now: () => now,
        setTimer: (callback) => {
          fire = callback;
          return { clear: () => undefined, unref: () => undefined };
        },
      },
    });
    await backwards.unlock(passphrase);
    now -= 60 * MINUTE;
    fire?.();
    expect(backwards.isUnlocked).toBe(false);
    expect(holder.isUnlocked).toBe(true);
  });

  it('cancels the timer when locked, and a touch while locked does nothing', async () => {
    const { holder, timers } = await unlockedHolder(10 * MINUTE);
    holder.lock('explicit');
    expect(timers.pending()).toBe(0);
    holder.touch();
    expect(timers.pending()).toBe(0);
  });

  it('rejects an idle period that is not a non-negative whole number of milliseconds', () => {
    const store = createMemoryKeyringStore();
    for (const idleMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new KeyHolder({ store, policy: { idleMs } })).toThrow(RangeError);
    }
  });

  it('arms real timers that can be unref’d and cleared', () => {
    const timer = createNodeTimers().setTimer(() => undefined, 60 * MINUTE);
    timer.unref();
    timer.clear();
  });
});

describe('KeyHolder — explicit locking', () => {
  it.each<TLockReason>(['explicit', 'idle', 'last-client-detached', 'screen-lock', 'suspend'])(
    'reports %s to the listeners and refuses to use the keys afterwards',
    async (reason) => {
      const { keyring } = await fixtureKeyring();
      const { holder, reasons } = await unlockedHolder();
      const aad = Buffer.from('aad');
      const sealed = sealBlob(getSealingPublicKey(keyring), Buffer.from('x'), aad);
      expect(Buffer.from(holder.openBlob(sealed, aad)).toString('utf8')).toBe('x');
      holder.lock(reason);

      expect(reasons).toEqual([reason]);
      expect(holder.isUnlocked).toBe(false);
      expect(() => holder.openBlob(sealed, aad)).toThrow(KeyringError);
      try {
        holder.openBlob(sealed, aad);
      } catch (error) {
        expect((error as KeyringError).code).toBe('keys-locked');
      }
    },
  );

  it('is silent when it is already locked', async () => {
    const { holder, reasons } = await unlockedHolder();
    holder.lock('explicit');
    holder.lock('suspend');
    expect(reasons).toEqual(['explicit']);
  });

  it('throws keys-locked before any unlock', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring) });
    expect(holder.isUnlocked).toBe(false);
    expect(() => holder.openBlob(new Uint8Array(200), Buffer.from('aad'))).toThrow(KeyringError);
  });

  it('keeps locking and notifying the others when one listener throws', async () => {
    const { holder } = await unlockedHolder();
    const later: TLockReason[] = [];
    holder.onLock(() => {
      throw new Error('listener failed');
    });
    holder.onLock((reason) => later.push(reason));
    holder.lock('screen-lock');
    expect(holder.isUnlocked).toBe(false);
    expect(later).toEqual(['screen-lock']);
  });

  it('stops notifying a listener that unsubscribed', async () => {
    const { holder } = await unlockedHolder();
    const heard: TLockReason[] = [];
    const unsubscribe = holder.onLock((reason) => heard.push(reason));
    unsubscribe();
    holder.lock('explicit');
    expect(heard).toEqual([]);
  });

  it('cancels an unlock still deriving when a lock arrives', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    const pending = holder.unlock(passphrase);
    holder.lock('suspend');
    await expect(pending).rejects.toMatchObject({ code: 'keys-locked' });
    expect(holder.isUnlocked).toBe(false);
  });
});

describe('KeyHolder — unlocking', () => {
  it('unlocks with the recovery key as well', async () => {
    const { keyring, recoveryKey } = await fixtureKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    await expect(holder.unlock({ type: 'recoveryKey', recoveryKey })).resolves.toEqual({
      sealingKey: 'verified',
    });
    expect(holder.isUnlocked).toBe(true);
  });

  it('leaves it locked after a wrong credential, and a tampered slot fails the same way', async () => {
    const { keyring } = await fixtureKeyring();
    const store = createMemoryKeyringStore(keyring);
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });

    const wrong = await holder
      .unlock({ type: 'passphrase', passphrase: OTHER_PASSPHRASE })
      .catch((e: unknown) => e);

    const slots = keyring.slots.map((slot) =>
      slot.type === 'passphrase' ? { ...slot, iv: slot.wrappedKey.slice(0, slot.iv.length) } : slot,
    );
    store.tamper({ ...keyring, slots } as IKeyring);
    const tampered = await holder.unlock(passphrase).catch((e: unknown) => e);

    expect(wrong).toBeInstanceOf(KeyringError);
    expect(tampered).toBeInstanceOf(KeyringError);
    expect((wrong as KeyringError).code).toBe('wrong-credential');
    expect((tampered as KeyringError).code).toBe('wrong-credential');
    expect((tampered as KeyringError).message).toBe((wrong as KeyringError).message);
    expect(holder.isUnlocked).toBe(false);
    expect(store.saves).toHaveLength(0);
  });

  it('refuses to unlock when there is no keyring', async () => {
    const holder = new KeyHolder({ store: createMemoryKeyringStore(), policy: { idleMs: 0 } });
    await expect(holder.unlock(passphrase)).rejects.toMatchObject({ code: 'missing' });
    expect(holder.isUnlocked).toBe(false);
  });

  it('a failed second unlock changes nothing about keys already held', async () => {
    const { holder } = await unlockedHolder();
    await expect(
      holder.unlock({ type: 'passphrase', passphrase: OTHER_PASSPHRASE }),
    ).rejects.toBeInstanceOf(KeyringError);
    expect(holder.isUnlocked).toBe(true);
  });

  it('reports verified when the stored sealing key is the derived one, and writes nothing', async () => {
    const { keyring } = await fixtureKeyring();
    const store = createMemoryKeyringStore(keyring);
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
    await expect(holder.unlock(passphrase)).resolves.toEqual({ sealingKey: 'verified' });
    expect(store.saves).toHaveLength(0);
  });

  it('repairs a swapped sealing key through the store and says so', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await strangerKeyring();
    const swapped = withSwappedSealingKey(keyring, other.keyring);
    const store = createMemoryKeyringStore(swapped);
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });

    await expect(holder.unlock(passphrase)).resolves.toEqual({ sealingKey: 'repaired' });
    expect(store.saves).toHaveLength(1);
    expect(store.current()?.sealingPublicKey).toBe(keyring.sealingPublicKey);
    expect(holder.isUnlocked).toBe(true);

    holder.lock('explicit');
    const again = new KeyHolder({ store, policy: { idleMs: 0 } });
    await expect(again.unlock(passphrase)).resolves.toEqual({ sealingKey: 'verified' });
  });

  it('stays locked, and says why, when the repair cannot be written', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await strangerKeyring();
    const store = createMemoryKeyringStore(withSwappedSealingKey(keyring, other.keyring));
    store.failSaves(new KeyringStoreError('write-failed', store.path, 'EROFS'));
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });

    await expect(holder.unlock(passphrase)).rejects.toMatchObject({
      repairFailure: 'write-failed',
    });
    expect(holder.isUnlocked).toBe(false);
  });
});

describe('KeyHolder — the sealing public key', () => {
  it('returns what the file holds before any unlock', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring) });
    expect(fingerprint(holder.sealingPublicKey())).toBe(fingerprint(getSealingPublicKey(keyring)));
  });

  it('keeps the verified key after a lock, whatever the file later says', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await strangerKeyring();
    const store = createMemoryKeyringStore(keyring);
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
    await holder.unlock(passphrase);
    holder.lock('idle');

    store.tamper(withSwappedSealingKey(keyring, other.keyring));
    expect(fingerprint(holder.sealingPublicKey())).toBe(fingerprint(getSealingPublicKey(keyring)));
    expect(holder.isUnlocked).toBe(false);
  });

  it('hands out copies, so a caller cannot change the retained key', async () => {
    const { holder } = await unlockedHolder();
    const first = holder.sealingPublicKey();
    first.fill(0);
    expect(holder.sealingPublicKey().some((byte) => byte !== 0)).toBe(true);
  });

  it('says there is no keyring rather than inventing a key', () => {
    const holder = new KeyHolder({ store: createMemoryKeyringStore() });
    expect(() => holder.sealingPublicKey()).toThrow(KeyringStoreError);
  });
});

describe('KeyHolder — a swapped sealing key is never lost', () => {
  it('seals to the verified key from the moment it is derived, even when the repair cannot be written', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await strangerKeyring();
    const store = createMemoryKeyringStore(withSwappedSealingKey(keyring, other.keyring));
    store.failSaves(new KeyringStoreError('write-failed', store.path, 'EROFS'));
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });

    await expect(holder.unlock(passphrase)).rejects.toBeDefined();
    expect(holder.isUnlocked).toBe(false);
    expect(fingerprint(holder.sealingPublicKey())).toBe(fingerprint(getSealingPublicKey(keyring)));
  });

  it('reports a repair that cannot be written as the mismatch, with both fingerprints', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await strangerKeyring();
    const store = createMemoryKeyringStore(withSwappedSealingKey(keyring, other.keyring));
    store.failSaves(new KeyringStoreError('write-failed', store.path, 'EROFS'));
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });

    const error = await holder.unlock(passphrase).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SealingKeyMismatchError);
    const mismatch = error as SealingKeyMismatchError;
    expect(mismatch.storedFingerprint).toBe(fingerprint(getSealingPublicKey(other.keyring)));
    expect(mismatch.derivedFingerprint).toBe(fingerprint(getSealingPublicKey(keyring)));
    expect(mismatch.repairFailure).toBe('write-failed');
  });

  it('does not let its repair undo a change another process made while it was unlocking', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'key-holder-race-')));
    try {
      const { keyring } = await fixtureKeyring();
      const other = await strangerKeyring();
      const path = join(root, 'secure', 'keyring.json');
      mkdirSync(join(root, 'secure'));
      writeFileSync(path, serializeKeyring(withSwappedSealingKey(keyring, other.keyring)), {
        mode: 0o600,
      });
      const fileStore = createKeyringFileStore({ path, root });
      // What another process writes while this one derives its keys (a passphrase change, say).
      const theirs = { ...keyring, slots: [...keyring.slots].reverse() };
      const racing = {
        ...fileStore,
        load: () => {
          const snapshot = fileStore.load();
          writeFileSync(path, serializeKeyring(theirs), { mode: 0o600 });
          return snapshot;
        },
      };
      const holder = new KeyHolder({ store: racing, policy: { idleMs: 0 } });

      const error = await holder.unlock(passphrase).catch((e: unknown) => e);
      expect(readFileSync(path, 'utf8')).toBe(serializeKeyring(theirs));
      expect(error).toBeInstanceOf(SealingKeyMismatchError);
      expect((error as SealingKeyMismatchError).repairFailure).toBe('changed');
      expect(holder.isUnlocked).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('KeyHolder — operations, not key objects', () => {
  it('hands out no unlocked keys, and opens sealed blobs only while unlocked', async () => {
    const { keyring } = await fixtureKeyring();
    const { holder } = await unlockedHolder();
    expect((holder as unknown as Record<string, unknown>).unlockedKeys).toBeUndefined();

    const aad = Buffer.from('robota/test|session-record|s1');
    const sealed = sealBlob(getSealingPublicKey(keyring), Buffer.from('plain'), aad);
    expect(Buffer.from(holder.openBlob(sealed, aad)).toString('utf8')).toBe('plain');

    holder.lock('explicit');
    let thrown: unknown;
    try {
      holder.openBlob(sealed, aad);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KeyringError);
    expect((thrown as KeyringError).code).toBe('keys-locked');
  });

  it('puts the verified sealing key into a document built while unlocked', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await strangerKeyring();
    const { holder } = await unlockedHolder();
    const rebuilt = holder.withVerifiedSealingKey(withSwappedSealingKey(keyring, other.keyring));
    expect(rebuilt.sealingPublicKey).toBe(keyring.sealingPublicKey);
    holder.lock('explicit');
    expect(() => holder.withVerifiedSealingKey(keyring)).toThrow(KeyringError);
  });
});

describe('KeyHolder — the verified sealing key', () => {
  it('is unknown before any unlock, without reading the file', async () => {
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
    const holder = new KeyHolder({ store: counting, policy: { idleMs: 0 } });
    expect(holder.verifiedSealingKey()).toBeUndefined();
    expect(loads).toBe(0);
  });

  it('is the derived key after an unlock, and stays after a lock', async () => {
    const { keyring } = await fixtureKeyring();
    const { holder } = await unlockedHolder();
    expect(fingerprint(holder.verifiedSealingKey() as Uint8Array)).toBe(
      fingerprint(getSealingPublicKey(keyring)),
    );
    holder.lock('explicit');
    expect(fingerprint(holder.verifiedSealingKey() as Uint8Array)).toBe(
      fingerprint(getSealingPublicKey(keyring)),
    );
  });

  it('is set by an unlock whose repair of a swapped key could not be written', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await strangerKeyring();
    const store = createMemoryKeyringStore(withSwappedSealingKey(keyring, other.keyring));
    store.failSaves(new KeyringStoreError('write-failed', store.path, 'EROFS'));
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
    await expect(holder.unlock(passphrase)).rejects.toBeInstanceOf(SealingKeyMismatchError);
    expect(fingerprint(holder.verifiedSealingKey() as Uint8Array)).toBe(
      fingerprint(getSealingPublicKey(keyring)),
    );
  });

  it('hands out copies', async () => {
    const { holder } = await unlockedHolder();
    (holder.verifiedSealingKey() as Uint8Array).fill(0);
    expect((holder.verifiedSealingKey() as Uint8Array).some((byte) => byte !== 0)).toBe(true);
  });
});

/**
 * A subagent child seals to the grant it was started with; when the parent's first
 * unlock verifies its key (or a later one verifies another), the parent tells its running children.
 * This is the holder's half: one call each time the verified key is set to a different value.
 */
describe('KeyHolder — telling when the verified sealing key changes', () => {
  it('tells once when the first unlock sets it, and not again for the same key', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    let calls = 0;
    holder.onSealingKeyChange(() => {
      calls += 1;
    });

    await holder.unlock(passphrase);
    holder.lock('explicit');
    await holder.unlock(passphrase);

    expect(calls).toBe(1);
  });

  it('tells again when an unlock verifies another key, and for one whose repair failed', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await strangerKeyring();
    const store = createMemoryKeyringStore(keyring);
    const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
    const seen: string[] = [];
    holder.onSealingKeyChange(() => {
      seen.push(fingerprint(holder.verifiedSealingKey() as Uint8Array));
    });
    await holder.unlock(passphrase);
    // Another keyring is put in place, and its stored key swapped, with the repair refused.
    store.tamper(withSwappedSealingKey(other.keyring, keyring));
    store.failSaves(new KeyringStoreError('write-failed', store.path, 'EROFS'));

    await expect(
      holder.unlock({ type: 'passphrase', passphrase: OTHER_PASSPHRASE }),
    ).rejects.toBeInstanceOf(SealingKeyMismatchError);

    expect(seen).toEqual([
      fingerprint(getSealingPublicKey(keyring)),
      fingerprint(getSealingPublicKey(other.keyring)),
    ]);
  });

  it('keeps unlocking when a listener throws, and stops telling one that unsubscribed', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    let calls = 0;
    holder.onSealingKeyChange(() => {
      throw new Error('a broken listener');
    });
    const stop = holder.onSealingKeyChange(() => {
      calls += 1;
    });
    stop();

    await expect(holder.unlock(passphrase)).resolves.toEqual({ sealingKey: 'verified' });
    expect(calls).toBe(0);
  });
});

describe('KeyHolder — the idle period fits a timer', () => {
  it('rejects an idle period longer than a timer can wait, instead of re-arming every millisecond', () => {
    const store = createMemoryKeyringStore();
    expect(() => new KeyHolder({ store, policy: { idleMs: 2 ** 31 } })).toThrow(RangeError);
    expect(() => new KeyHolder({ store, policy: { idleMs: 2 ** 31 - 1 } })).not.toThrow();
  });
});
