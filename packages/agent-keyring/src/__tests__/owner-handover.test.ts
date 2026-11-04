/**
 * The owner handover: one unlock that holds the attach key for as long as a command needs it and
 * hands out operations, never keys. Certifying a runtime instance is its one public operation; the
 * certificate is pinned against a signature made outside this package.
 */
import { Buffer } from 'node:buffer';
import { createPublicKey, KeyObject, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fingerprint, openOwnerHandover, parseKeyring, type IKeyring } from '../index.js';
import { toBase64Url } from '../bytes.js';
import { deriveKeyPairs } from '../key-pairs.js';
import {
  FIXTURE_PASSPHRASE_AS_TYPED,
  FIXTURE_RECOVERY_KEY,
  KAT_BINDING,
  KAT_CERTIFICATE_HEX,
  KAT_CERTIFICATE_NEXT_GENERATION_HEX,
  KAT_INSTANCE_PUBLIC_KEY_HEX,
  KAT_NEXT_GENERATION,
  KNOWN_ATTACH_PUBLIC_KEY_HEX,
  bytesOf,
  codeOf,
  codeOfAsync,
  hex,
  lengthPrefixed,
  reachableValues,
} from './helpers.js';

const fixture = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);
const recovery = { type: 'recoveryKey', recoveryKey: FIXTURE_RECOVERY_KEY } as const;
const instance = Buffer.from(KAT_INSTANCE_PUBLIC_KEY_HEX, 'hex');

function ed25519FromRaw(raw: Uint8Array): KeyObject {
  return createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
    format: 'der',
    type: 'spki',
  });
}

describe('openOwnerHandover', () => {
  it('certifies an instance for a binding with the attach key the master key derives', async () => {
    const handover = await openOwnerHandover(fixture, recovery);
    const root = handover.certify(instance, KAT_BINDING);
    expect(hex(root.attachPublicKey)).toBe(KNOWN_ATTACH_PUBLIC_KEY_HEX);
    expect(hex(root.certificate)).toBe(KAT_CERTIFICATE_HEX);
    const message = lengthPrefixed(
      bytesOf('robota/link/v1/runtime-cert'),
      instance,
      bytesOf(KAT_BINDING.runtimeId),
      bytesOf(KAT_BINDING.generation),
    );
    expect(verify(null, message, ed25519FromRaw(root.attachPublicKey), root.certificate)).toBe(
      true,
    );
    const next = handover.certify(instance, { ...KAT_BINDING, generation: KAT_NEXT_GENERATION });
    expect(hex(next.certificate)).toBe(KAT_CERTIFICATE_NEXT_GENERATION_HEX);
    handover.dispose();
  });

  it('opens with the passphrase too, and refuses a wrong credential as an unlock does', async () => {
    const handover = await openOwnerHandover(fixture, {
      type: 'passphrase',
      passphrase: FIXTURE_PASSPHRASE_AS_TYPED,
    });
    expect(hex(handover.certify(instance, KAT_BINDING).certificate)).toBe(KAT_CERTIFICATE_HEX);
    handover.dispose();
    expect(
      await codeOfAsync(openOwnerHandover(fixture, { type: 'passphrase', passphrase: 'wrong' })),
    ).toBe('wrong-credential');
    expect(await codeOfAsync(openOwnerHandover(fixture, { type: 'other' } as never))).toBe(
      'invalid-argument',
    );
  });

  it('says whether the file holds the derived sealing key, and shows its fingerprint', async () => {
    const intact = await openOwnerHandover(fixture, recovery);
    expect(intact.sealingKeyMatches).toBe(true);
    expect(intact.fingerprint).toBe('3A2E-D129-B98E-02D9-DF09');
    intact.dispose();

    const attacker = deriveKeyPairs(Buffer.alloc(32, 0xee)).sealing.publicKey;
    const swapped: IKeyring = { ...fixture, sealingPublicKey: toBase64Url(attacker) };
    const handover = await openOwnerHandover(swapped, recovery);
    expect(handover.sealingKeyMatches).toBe(false);
    // The fingerprint is the derived key's, so the person compares what the passphrase opens.
    expect(handover.fingerprint).toBe('3A2E-D129-B98E-02D9-DF09');
    expect(handover.fingerprint).not.toBe(fingerprint(attacker));
    handover.dispose();
  });

  it('hands out no key: nothing reachable from it is a key object or key bytes', async () => {
    const handover = await openOwnerHandover(fixture, recovery);
    const reachable = reachableValues(handover);
    expect(reachable.some((value) => value instanceof KeyObject)).toBe(false);
    expect(reachable.some((value) => ArrayBuffer.isView(value))).toBe(false);
    expect(JSON.stringify(handover)).toBe('{}');
    handover.dispose();
  });

  it('refuses an instance key or binding it cannot certify unambiguously', async () => {
    const handover = await openOwnerHandover(fixture, recovery);
    const refused = (key: Uint8Array, binding: unknown): string =>
      codeOf(() => handover.certify(key, binding as typeof KAT_BINDING));
    expect(refused(instance.subarray(0, 31), KAT_BINDING)).toBe('invalid-argument');
    expect(refused('key' as never, KAT_BINDING)).toBe('invalid-argument');
    for (const binding of [
      undefined,
      { runtimeId: '', generation: 'g' },
      { runtimeId: 'r', generation: '' },
      { runtimeId: 'a b', generation: 'g' },
      { runtimeId: 'r', generation: 'g\n' },
      { runtimeId: 'ré', generation: 'g' },
      { runtimeId: 'r'.repeat(129), generation: 'g' },
      { runtimeId: 'r', generation: 7 },
      { runtimeId: 'r', generation: 'g', extra: 'x' },
    ]) {
      expect(refused(instance, binding)).toBe('invalid-argument');
    }
    expect(
      hex(
        handover.certify(instance, { runtimeId: 'r'.repeat(128), generation: 'g' }).attachPublicKey,
      ),
    ).toBe(KNOWN_ATTACH_PUBLIC_KEY_HEX);
    handover.dispose();
  });

  it('drops everything on dispose, after which it certifies nothing', async () => {
    const handover = await openOwnerHandover(fixture, recovery);
    expect(handover.disposed).toBe(false);
    handover.dispose();
    expect(handover.disposed).toBe(true);
    expect(codeOf(() => handover.certify(instance, KAT_BINDING))).toBe('keys-locked');
    expect(codeOf(() => handover.sealingKeyMatches)).toBe('keys-locked');
    expect(codeOf(() => handover.fingerprint)).toBe('keys-locked');
    handover.dispose();
    expect(handover.disposed).toBe(true);
  });
});
