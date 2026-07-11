import { describe, expect, it } from 'vitest';

import {
  deriveIdentityId,
  exportKeyPairJwk,
  exportPublicKey,
  generateIdentityKeyPair,
  importKeyPairJwk,
  importPublicKey,
  signChallenge,
  verifyChallenge,
  type IReconnectChallenge,
} from '../device-identity.js';

/**
 * REMOTE-012 E3 TC-01/02 — the isomorphic ECDSA device/host identity primitives, under Node WebCrypto (the
 * same code path the browser runs). Proves the channel-bound reconnect signature round-trips and fails closed
 * on any tampered field, and that identity ids + SPKI export/import are stable.
 */

function challenge(over: Partial<IReconnectChallenge> = {}): IReconnectChallenge {
  return {
    deviceId: 'device-id',
    hostIdentityId: 'host-id',
    nonceHost: 'aG9zdG5vbmNl',
    nonceDevice: 'ZGV2bm9uY2U',
    localFingerprint: 'AA:BB:CC',
    remoteFingerprint: 'DD:EE:FF',
    ...over,
  };
}

describe('device-identity signChallenge/verifyChallenge (REMOTE-012 TC-01)', () => {
  it('a signature verifies with the matching public key over the same transcript', async () => {
    const pair = await generateIdentityKeyPair(false);
    const spki = await exportPublicKey(pair.publicKey);
    const pub = await importPublicKey(spki);
    const c = challenge();
    const sig = await signChallenge(pair.privateKey, c);
    expect(await verifyChallenge(pub, sig, c)).toBe(true);
  });

  it('fails closed for a different nonce (host or device), a different fingerprint pair, or a different key', async () => {
    const pair = await generateIdentityKeyPair(false);
    const pub = await importPublicKey(await exportPublicKey(pair.publicKey));
    const c = challenge();
    const sig = await signChallenge(pair.privateKey, c);

    expect(await verifyChallenge(pub, sig, challenge({ nonceHost: 'b3RoZXI' }))).toBe(false);
    expect(await verifyChallenge(pub, sig, challenge({ nonceDevice: 'b3RoZXI' }))).toBe(false);
    expect(await verifyChallenge(pub, sig, challenge({ remoteFingerprint: '99:99:99' }))).toBe(
      false,
    );
    expect(await verifyChallenge(pub, sig, challenge({ deviceId: 'other-device' }))).toBe(false);

    const other = await generateIdentityKeyPair(false);
    const otherPub = await importPublicKey(await exportPublicKey(other.publicKey));
    expect(await verifyChallenge(otherPub, sig, c)).toBe(false);
  });

  it('is order-independent in the fingerprint pair (sortedPair binding)', async () => {
    const pair = await generateIdentityKeyPair(false);
    const pub = await importPublicKey(await exportPublicKey(pair.publicKey));
    const sig = await signChallenge(
      pair.privateKey,
      challenge({ localFingerprint: 'AA', remoteFingerprint: 'BB' }),
    );
    // The counterpart observes the same two fingerprints with local/remote swapped.
    expect(
      await verifyChallenge(
        pub,
        sig,
        challenge({ localFingerprint: 'BB', remoteFingerprint: 'AA' }),
      ),
    ).toBe(true);
  });
});

describe('device-identity ids + key export/import (REMOTE-012 TC-02)', () => {
  it('deriveIdentityId is stable for a key and differs across keys', async () => {
    const a = await exportPublicKey((await generateIdentityKeyPair(false)).publicKey);
    const b = await exportPublicKey((await generateIdentityKeyPair(false)).publicKey);
    expect(await deriveIdentityId(a)).toBe(await deriveIdentityId(a));
    expect(await deriveIdentityId(a)).not.toBe(await deriveIdentityId(b));
  });

  it('a host keypair round-trips through JWK export/import and still signs verifiably', async () => {
    const pair = await generateIdentityKeyPair(true);
    const jwk = await exportKeyPairJwk(pair);
    const reloaded = await importKeyPairJwk(jwk);
    const spki = await exportPublicKey(reloaded.publicKey);
    const pub = await importPublicKey(spki);
    const c = challenge();
    expect(await verifyChallenge(pub, await signChallenge(reloaded.privateKey, c), c)).toBe(true);
  });

  it('a non-extractable device private key cannot be exported', async () => {
    const pair = await generateIdentityKeyPair(false);
    await expect(webcrypto_subtle_export(pair.privateKey)).rejects.toBeTruthy();
  });
});

function webcrypto_subtle_export(key: CryptoKey): Promise<JsonWebKey> {
  return globalThis.crypto.subtle.exportKey('jwk', key);
}
