import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { gcmDecrypt, GCM_IV_BYTES } from '../aead.js';
import { concatLengthPrefixed, fromBase64Url, toBase64Url, utf8 } from '../bytes.js';
import type { IPassphraseKeyslot, IRecoveryKeyslot } from '../keyring-types.js';
import {
  deriveRecoveryKek,
  keyslotAad,
  newSlotId,
  unwrapMasterKey,
  wrapMasterKey,
} from '../keyslot.js';
import { codeOf, FIXED_MASTER_KEY, hex, tamper } from './helpers.js';

const kek = randomBytes(32);

function recoverySlotFor(masterKey: Uint8Array, slotId = newSlotId()): IRecoveryKeyslot {
  return { id: slotId, type: 'recovery', ...wrapMasterKey(kek, masterKey, slotId, 'recovery') };
}

describe('keyslot wrapping', () => {
  it('wraps and unwraps the master key', () => {
    const slot = recoverySlotFor(FIXED_MASTER_KEY);
    expect(fromBase64Url(slot.iv, GCM_IV_BYTES)).toBeDefined();
    expect(fromBase64Url(slot.wrappedKey, 48)).toBeDefined();
    expect(hex(unwrapMasterKey(kek, slot))).toBe(hex(FIXED_MASTER_KEY));
  });

  it('uses a fresh IV for every wrap, so one master key never wraps to the same bytes', () => {
    const ivs = new Set<string>();
    const wrapped = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const slot = recoverySlotFor(FIXED_MASTER_KEY, 'AAAAAAAAAAAAAAAAAAAAAA');
      ivs.add(slot.iv);
      wrapped.add(slot.wrappedKey);
    }
    expect(ivs.size).toBe(100);
    expect(wrapped.size).toBe(100);
  });

  it('fails under a different key-encryption key', () => {
    const slot = recoverySlotFor(FIXED_MASTER_KEY);
    expect(codeOf(() => unwrapMasterKey(randomBytes(32), slot))).toBe('wrong-credential');
  });

  it('binds the slot id', () => {
    const slot = recoverySlotFor(FIXED_MASTER_KEY);
    expect(codeOf(() => unwrapMasterKey(kek, { ...slot, id: newSlotId() }))).toBe(
      'wrong-credential',
    );
  });

  it('binds the slot type', () => {
    const slot = recoverySlotFor(FIXED_MASTER_KEY);
    const relabelled: IPassphraseKeyslot = {
      ...slot,
      type: 'passphrase',
      kdf: { algorithm: 'scrypt', N: 2 ** 17, r: 8, p: 1, salt: toBase64Url(randomBytes(16)) },
    };
    expect(codeOf(() => unwrapMasterKey(kek, relabelled))).toBe('wrong-credential');
  });

  it('binds the keyring version, but not the sealing public key', () => {
    const slot = recoverySlotFor(FIXED_MASTER_KEY);
    const iv = fromBase64Url(slot.iv, GCM_IV_BYTES) as Buffer;
    const wrapped = fromBase64Url(slot.wrappedKey, 48) as Buffer;
    const aadFor = (version: number) =>
      concatLengthPrefixed([Buffer.from([version]), utf8(slot.id), utf8(slot.type)]);
    expect(hex(gcmDecrypt(kek, iv, wrapped, aadFor(1)))).toBe(hex(FIXED_MASTER_KEY));
    expect(() => gcmDecrypt(kek, iv, wrapped, aadFor(2))).toThrow();
    // The AAD is exactly version | slot id | slot type, so no public key can be part of it.
    expect(hex(keyslotAad(slot.id, slot.type))).toBe(hex(aadFor(1)));
  });

  it('fails on a change to any byte of the IV or the wrapped key', () => {
    const slot = recoverySlotFor(FIXED_MASTER_KEY);
    const iv = fromBase64Url(slot.iv, GCM_IV_BYTES) as Buffer;
    const wrapped = fromBase64Url(slot.wrappedKey, 48) as Buffer;
    for (let index = 0; index < iv.length; index += 1) {
      const changed = { ...slot, iv: toBase64Url(tamper(iv, index)) };
      expect(codeOf(() => unwrapMasterKey(kek, changed))).toBe('wrong-credential');
    }
    for (let index = 0; index < wrapped.length; index += 1) {
      const changed = { ...slot, wrappedKey: toBase64Url(tamper(wrapped, index)) };
      expect(codeOf(() => unwrapMasterKey(kek, changed))).toBe('wrong-credential');
    }
  });

  it('derives the recovery key-encryption key deterministically and independently of the key', () => {
    const first = deriveRecoveryKek(Buffer.alloc(20, 1));
    expect(hex(first)).toBe(hex(deriveRecoveryKek(Buffer.alloc(20, 1))));
    expect(hex(first)).not.toBe(hex(deriveRecoveryKek(Buffer.alloc(20, 2))));
    expect(first).toHaveLength(32);
  });
});
