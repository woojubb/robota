import { describe, expect, it } from 'vitest';

import { createIdentityContext } from '../identity/crypto-context.js';
import {
  certifySigningKey,
  decodeSigningKeyCertificate,
  generateSigningKeyPair,
  signingKeyCertificateBytes,
} from '../identity/certificates.js';
import { keyIdOf, verifyCanonical } from '../identity/encoding.js';
import { deriveReconnectSeed, deriveReconnectRendezvous } from '../reconnect-rendezvous.js';
import { deriveSessionKey } from '../pairing.js';

describe('product cryptographic domain separation', () => {
  it('preserves the existing Robota pairing and reconnect key vectors', async () => {
    const context = createIdentityContext('robota');
    const key = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
    expect(await deriveSessionKey(context, key)).toBe(
      'md5SdS0WTDF4e2S5XngVBP1XovityvGb9SJE8Rvwnxo',
    );
    expect(await deriveReconnectSeed(context, key)).toBe(
      '850emH2wwsUy7SKUd1f3qul6TSE6o191acDuWC_60qs',
    );
  });
  const a = createIdentityContext('product-a');
  const b = createIdentityContext('product-b');

  it('refuses a different product certificate even when key material is identical', async () => {
    const root = await generateSigningKeyPair({ extractable: false });
    const signing = await generateSigningKeyPair({ extractable: false });
    const options = {
      masterPrivateKey: root.privateKey,
      userId: await keyIdOf(root.publicKey),
      signingPublicKey: signing.publicKey,
      issuedAt: 1000,
    };
    const [certA, certB] = await Promise.all([
      certifySigningKey(a, options),
      certifySigningKey(b, options),
    ]);
    expect(decodeSigningKeyCertificate(a, certA).ok).toBe(true);
    expect(decodeSigningKeyCertificate(b, certA)).toEqual({
      ok: false,
      reason: 'wrong-purpose',
      field: 'ctx',
    });
    expect(certA.sig).not.toBe(certB.sig);
    expect(
      await verifyCanonical(root.publicKey, certA.sig, signingKeyCertificateBytes(b, certA)),
    ).toBe(false);
    expect((await certifySigningKey(a, options)).sig).toBe(certA.sig);
  });

  it('separates reconnect seeds and rendezvous with a shared input key', async () => {
    const key = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
    const [seedA, seedB] = await Promise.all([
      deriveReconnectSeed(a, key),
      deriveReconnectSeed(b, key),
    ]);
    expect(seedA).not.toBe(seedB);
    expect(await deriveReconnectRendezvous(a, seedA, 1)).not.toBe(
      await deriveReconnectRendezvous(b, seedA, 1),
    );
    expect(await deriveReconnectSeed(a, key)).toBe(seedA);
  });
});
