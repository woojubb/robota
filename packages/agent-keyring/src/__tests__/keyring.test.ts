import { Buffer } from 'node:buffer';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  changePassphrase,
  checkSealingPublicKey,
  createKeyring,
  getSealingPublicKey,
  openBlob,
  parseKeyring,
  repairSealingPublicKey,
  sealBlob,
  serializeKeyring,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type ICreatedKeyring,
  type IKeyring,
  type IPassphraseKeyslot,
  type IRecoveryKeyslot,
  type IUnlockedKeys,
} from '../index.js';
import { toBase64Url } from '../bytes.js';
import { deriveKeyPairs } from '../key-pairs.js';
import { bytesOf, codeOf, codeOfAsync, hex } from './helpers.js';

const PASSPHRASE = 'correct horse battery staple';

// One scrypt-backed creation shared by the tests below; each passphrase unlock costs ~160 ms.
let created: ICreatedKeyring;

beforeAll(async () => {
  created = await createKeyring({ passphrase: PASSPHRASE });
});

function privateKeyHex(keys: IUnlockedKeys): string {
  return hex(keys.sealing.privateKey.export({ format: 'der', type: 'pkcs8' }));
}

function passphraseSlot(keyring: IKeyring): IPassphraseKeyslot {
  return keyring.slots.find((slot) => slot.type === 'passphrase') as IPassphraseKeyslot;
}

function recoverySlot(keyring: IKeyring): IRecoveryKeyslot {
  return keyring.slots.find((slot) => slot.type === 'recovery') as IRecoveryKeyslot;
}

describe('createKeyring', () => {
  it('writes the documented version-1 document', () => {
    const { keyring } = created;
    expect(keyring.version).toBe(1);
    expect(keyring.slots.map((slot) => slot.type)).toEqual(['passphrase', 'recovery']);
    expect(passphraseSlot(keyring).kdf).toMatchObject({
      algorithm: 'scrypt',
      N: 131072,
      r: 8,
      p: 1,
    });
    expect(new Set(keyring.slots.map((slot) => slot.id)).size).toBe(2);
    expect(hex(getSealingPublicKey(keyring))).toBe(hex(created.unlocked.sealing.publicKey));
  });

  it('shows the recovery key once, in grouped Crockford base32', () => {
    expect(created.recoveryKey).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
    expect(serializeKeyring(created.keyring)).not.toContain(created.recoveryKey);
  });

  it('has no place in the file for the attach public key or any secret', () => {
    const text = serializeKeyring(created.keyring);
    expect(Object.keys(JSON.parse(text))).toEqual(['version', 'sealingPublicKey', 'slots']);
    const attach = Buffer.from(created.unlocked.attach.publicKey);
    for (const spelling of [
      attach.toString('hex'),
      attach.toString('base64'),
      attach.toString('base64url'),
    ]) {
      expect(text).not.toContain(spelling);
    }
    expect(text).not.toContain(PASSPHRASE);
    expect(
      codeOf(() => parseKeyring(text.replace('"slots"', '"attachPublicKey": "x", "slots"'))),
    ).toBe('malformed-keyring');
  });

  it('returns a document that survives a trip through serialization', () => {
    expect(parseKeyring(serializeKeyring(created.keyring))).toEqual(created.keyring);
  });

  it('refuses an empty passphrase before doing any work, and accepts anything else', async () => {
    expect(await codeOfAsync(createKeyring({ passphrase: '' }))).toBe('empty-passphrase');
    expect(await codeOfAsync(createKeyring({ passphrase: undefined as never }))).toBe(
      'invalid-argument',
    );
  });
});

describe('unlocking', () => {
  it('opens with the passphrase and yields the keys that were derived at creation', async () => {
    const unlocked = await unlockWithPassphrase(created.keyring, PASSPHRASE);
    expect(unlocked.locked).toBe(false);
    expect(hex(unlocked.sealing.publicKey)).toBe(hex(created.unlocked.sealing.publicKey));
    expect(hex(unlocked.attach.publicKey)).toBe(hex(created.unlocked.attach.publicKey));
    expect(privateKeyHex(unlocked)).toBe(privateKeyHex(created.unlocked));
  });

  it('keeps the event loop running while scrypt works', async () => {
    // scryptSync would hold the loop for the whole ~160 ms; the async form lets timers fire.
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 5);
    try {
      await unlockWithPassphrase(created.keyring, PASSPHRASE);
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(5);
  });

  it('opens with the recovery key however it is typed', async () => {
    const { keyring, recoveryKey } = created;
    for (const typed of [
      recoveryKey,
      recoveryKey.toLowerCase(),
      recoveryKey.replaceAll('-', ''),
      ` ${recoveryKey.replaceAll('-', ' ')} `,
    ]) {
      const unlocked = await unlockWithRecoveryKey(keyring, typed);
      expect(privateKeyHex(unlocked)).toBe(privateKeyHex(created.unlocked));
    }
  });

  it('refuses a wrong passphrase with wrong-credential', async () => {
    expect(await codeOfAsync(unlockWithPassphrase(created.keyring, `${PASSPHRASE}!`))).toBe(
      'wrong-credential',
    );
  });

  it('refuses a wrong recovery key with wrong-credential, and a malformed one differently', async () => {
    const wrong = created.recoveryKey.replace(/^./, (first) => (first === '0' ? '1' : '0'));
    expect(await codeOfAsync(unlockWithRecoveryKey(created.keyring, wrong))).toBe(
      'wrong-credential',
    );
    expect(await codeOfAsync(unlockWithRecoveryKey(created.keyring, 'not a recovery key'))).toBe(
      'invalid-recovery-key',
    );
  });

  it('refuses an empty or non-string passphrase before deriving anything', async () => {
    expect(await codeOfAsync(unlockWithPassphrase(created.keyring, ''))).toBe('empty-passphrase');
    expect(await codeOfAsync(unlockWithPassphrase(created.keyring, 42 as never))).toBe(
      'invalid-argument',
    );
  });

  it('refuses a tampered wrapped key, IV or slot id on the recovery slot', async () => {
    const slot = recoverySlot(created.keyring);
    const swapped = (patch: Partial<IRecoveryKeyslot>): IKeyring => ({
      ...created.keyring,
      slots: created.keyring.slots.map((existing) =>
        existing.id === slot.id ? { ...slot, ...patch } : existing,
      ),
    });
    const flipFirst = (encoded: string): string => {
      const bytes = Buffer.from(encoded, 'base64url');
      bytes[0] ^= 1;
      return bytes.toString('base64url');
    };
    for (const patch of [
      { wrappedKey: flipFirst(slot.wrappedKey) },
      { iv: flipFirst(slot.iv) },
      { id: toBase64Url(Buffer.alloc(16, 9)) },
    ]) {
      expect(await codeOfAsync(unlockWithRecoveryKey(swapped(patch), created.recoveryKey))).toBe(
        'wrong-credential',
      );
    }
  });

  it('validates a hand-built keyring as strictly as a parsed one', async () => {
    const withExtra = { ...created.keyring, attachPublicKey: 'x' } as unknown as IKeyring;
    expect(await codeOfAsync(unlockWithRecoveryKey(withExtra, created.recoveryKey))).toBe(
      'malformed-keyring',
    );
    expect(
      await codeOfAsync(
        unlockWithRecoveryKey({ ...created.keyring, version: 2 } as never, created.recoveryKey),
      ),
    ).toBe('unsupported-version');
  });

  it('reports a keyring without the needed slot type', async () => {
    const onlyRecovery: IKeyring = { ...created.keyring, slots: [recoverySlot(created.keyring)] };
    const onlyPassphrase: IKeyring = {
      ...created.keyring,
      slots: [passphraseSlot(created.keyring)],
    };
    expect(await codeOfAsync(unlockWithPassphrase(onlyRecovery, PASSPHRASE))).toBe(
      'slot-not-found',
    );
    expect(await codeOfAsync(unlockWithRecoveryKey(onlyPassphrase, created.recoveryKey))).toBe(
      'slot-not-found',
    );
  });
});

describe('a swapped sealing public key', () => {
  const attackerKey = deriveKeyPairs(Buffer.alloc(32, 0xee)).sealing.publicKey;

  function tampered(): IKeyring {
    return { ...created.keyring, sealingPublicKey: toBase64Url(attackerKey) };
  }

  it('does not stop the keyring from unlocking, and is reported by the check', async () => {
    const unlocked = await unlockWithRecoveryKey(tampered(), created.recoveryKey);
    expect(privateKeyHex(unlocked)).toBe(privateKeyHex(created.unlocked));
    expect(checkSealingPublicKey(tampered(), unlocked)).toEqual({ matches: false });
    expect(checkSealingPublicKey(created.keyring, unlocked)).toEqual({ matches: true });
  });

  it('can be repaired from the unlocked keys, after which sealing reaches the owner again', async () => {
    const unlocked = await unlockWithRecoveryKey(tampered(), created.recoveryKey);
    const repaired = repairSealingPublicKey(tampered(), unlocked);
    expect(checkSealingPublicKey(repaired, unlocked)).toEqual({ matches: true });
    expect(repaired.slots).toEqual(created.keyring.slots);
    const blob = sealBlob(getSealingPublicKey(repaired), bytesOf('hello'), bytesOf('a'));
    expect(openBlob(unlocked.sealing.privateKey, blob, bytesOf('a')).toString()).toBe('hello');
  });
});

describe('changePassphrase', () => {
  const NEW_PASSPHRASE = 'a different passphrase entirely';
  let changed: IKeyring;

  beforeAll(async () => {
    // The recovery key is the credential here, so the only scrypt run is the new slot's.
    changed = await changePassphrase(
      created.keyring,
      { type: 'recoveryKey', recoveryKey: created.recoveryKey },
      NEW_PASSPHRASE,
    );
  });

  it('re-wraps only the passphrase slot', () => {
    const before = created.keyring;
    expect(changed.sealingPublicKey).toBe(before.sealingPublicKey);
    expect(recoverySlot(changed)).toEqual(recoverySlot(before));
    const oldSlot = passphraseSlot(before);
    const newSlot = passphraseSlot(changed);
    expect(newSlot.id).toBe(oldSlot.id);
    expect(newSlot.kdf.salt).not.toBe(oldSlot.kdf.salt);
    expect(newSlot.iv).not.toBe(oldSlot.iv);
    expect(newSlot.wrappedKey).not.toBe(oldSlot.wrappedKey);
    expect(changed.slots.map((slot) => slot.type)).toEqual(['passphrase', 'recovery']);
  });

  it('leaves the master key, and so everything sealed under it, unchanged', async () => {
    const blob = sealBlob(getSealingPublicKey(created.keyring), bytesOf('kept'), bytesOf('a'));
    const unlocked = await unlockWithPassphrase(changed, NEW_PASSPHRASE);
    expect(privateKeyHex(unlocked)).toBe(privateKeyHex(created.unlocked));
    expect(openBlob(unlocked.sealing.privateKey, blob, bytesOf('a')).toString()).toBe('kept');
  });

  it('stops the old passphrase from working on the new keyring, and does not touch the input', async () => {
    expect(await codeOfAsync(unlockWithPassphrase(changed, PASSPHRASE))).toBe('wrong-credential');
    expect(created.keyring.slots.map((slot) => slot.id)).toEqual(
      changed.slots.map((slot) => slot.id),
    );
    expect(passphraseSlot(created.keyring).kdf.salt).not.toBe(passphraseSlot(changed).kdf.salt);
  });

  it('accepts the current passphrase as the credential', async () => {
    const again = await changePassphrase(
      changed,
      { type: 'passphrase', passphrase: NEW_PASSPHRASE },
      'third passphrase',
    );
    expect(passphraseSlot(again).id).toBe(passphraseSlot(changed).id);
    expect(recoverySlot(again)).toEqual(recoverySlot(changed));
  });

  it('refuses without a working credential, and an empty new passphrase before any work', async () => {
    const wrongRecovery = created.recoveryKey.replace(/^./, (first) => (first === '0' ? '1' : '0'));
    expect(
      await codeOfAsync(
        changePassphrase(created.keyring, { type: 'recoveryKey', recoveryKey: wrongRecovery }, 'x'),
      ),
    ).toBe('wrong-credential');
    expect(
      await codeOfAsync(
        changePassphrase(
          created.keyring,
          { type: 'recoveryKey', recoveryKey: created.recoveryKey },
          '',
        ),
      ),
    ).toBe('empty-passphrase');
    expect(
      await codeOfAsync(changePassphrase(created.keyring, { type: 'other' } as never, 'x')),
    ).toBe('invalid-argument');
  });
});

describe('lock', () => {
  it('stops handing out keys', async () => {
    const unlocked = await unlockWithRecoveryKey(created.keyring, created.recoveryKey);
    expect(unlocked.locked).toBe(false);
    unlocked.lock();
    expect(unlocked.locked).toBe(true);
    expect(codeOf(() => unlocked.sealing)).toBe('keys-locked');
    expect(codeOf(() => unlocked.attach)).toBe('keys-locked');
    expect(codeOf(() => checkSealingPublicKey(created.keyring, unlocked))).toBe('keys-locked');
    unlocked.lock();
    expect(unlocked.locked).toBe(true);
  });

  it('does not affect another unlocked set from the same keyring', async () => {
    const first = await unlockWithRecoveryKey(created.keyring, created.recoveryKey);
    const second = await unlockWithRecoveryKey(created.keyring, created.recoveryKey);
    first.lock();
    expect(hex(second.sealing.publicKey)).toBe(hex(created.unlocked.sealing.publicKey));
  });
});
