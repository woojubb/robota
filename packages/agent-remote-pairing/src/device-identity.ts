/**
 * Device + host identity keys and the channel-bound reconnect challenge (REMOTE-012 Stage E3).
 *
 * **Isomorphic** (WebCrypto only — no `node:`, no deps): the same module runs on the Node host and the
 * browser client. TOFU model: at first pairing (already authenticated by the B3 directional-HMAC handshake)
 * the device and host exchange and pin each other's ECDSA-P256 **public** keys. On reconnect, BOTH sides
 * sign a fresh, channel-bound challenge and verify the counterpart against the pinned key — the mutual dual
 * of B3, using pinned public keys instead of a shared secret. Directionality is intrinsic: each side signs
 * with its OWN private key and verifies with the OTHER's pinned public key, so a signature can never satisfy
 * the counterpart-verification (no reflection). A host trust-store leak reveals only public keys ⇒ no
 * impersonation; a rogue host cannot produce a valid host signature ⇒ the device fails closed.
 */
import {
  ab,
  encoder,
  fromBase64Url,
  sortedPair,
  toBase64Url,
  webcrypto,
} from './crypto-primitives.js';

const ECDSA_PARAMS: EcKeyImportParams & EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const ECDSA_SIGN: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

/** Serialized ECDSA keypair (JWK) — used ONLY by the host to persist its own extractable identity key. */
export interface IIdentityKeyPairJwk {
  readonly privateJwk: JsonWebKey;
  readonly publicJwk: JsonWebKey;
}

/**
 * Generate an ECDSA-P256 identity keypair. The browser device passes `extractable: false` (the private key
 * never leaves IndexedDB); the Node host passes `extractable: true` ONCE to persist its identity as a JWK.
 */
export function generateIdentityKeyPair(extractable: boolean): Promise<CryptoKeyPair> {
  return webcrypto.subtle.generateKey(ECDSA_PARAMS, extractable, [
    'sign',
    'verify',
  ]) as Promise<CryptoKeyPair>;
}

/** Export a public key as base64url SPKI — the value the counterpart pins. */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await webcrypto.subtle.exportKey('spki', key);
  return toBase64Url(new Uint8Array(spki));
}

/** Import a base64url SPKI public key for `verify`. */
export function importPublicKey(spkiBase64Url: string): Promise<CryptoKey> {
  return webcrypto.subtle.importKey('spki', ab(fromBase64Url(spkiBase64Url)), ECDSA_PARAMS, true, [
    'verify',
  ]);
}

/** Export the host's extractable keypair to JWKs (for a `0600` on-disk file). */
export async function exportKeyPairJwk(pair: CryptoKeyPair): Promise<IIdentityKeyPairJwk> {
  const [privateJwk, publicJwk] = await Promise.all([
    webcrypto.subtle.exportKey('jwk', pair.privateKey),
    webcrypto.subtle.exportKey('jwk', pair.publicKey),
  ]);
  return { privateJwk, publicJwk };
}

/** Reload a host keypair from persisted JWKs (private key extractable so it can be re-exported/re-persisted). */
export async function importKeyPairJwk(jwk: IIdentityKeyPairJwk): Promise<CryptoKeyPair> {
  const [privateKey, publicKey] = await Promise.all([
    webcrypto.subtle.importKey('jwk', jwk.privateJwk, ECDSA_PARAMS, true, ['sign']),
    webcrypto.subtle.importKey('jwk', jwk.publicJwk, ECDSA_PARAMS, true, ['verify']),
  ]);
  return { privateKey, publicKey };
}

/**
 * Stable, non-secret identity id = base64url `SHA-256(SPKI)`. Used as the `deviceId` a client sends in the
 * clear on reconnect, and the `hostIdentityId` the browser credential store keys on.
 */
export async function deriveIdentityId(spkiBase64Url: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', ab(fromBase64Url(spkiBase64Url)));
  return toBase64Url(new Uint8Array(digest));
}

/** The fields bound into a reconnect signature. Both sides construct the identical canonical transcript. */
export interface IReconnectChallenge {
  readonly deviceId: string;
  readonly hostIdentityId: string;
  readonly nonceHost: string;
  readonly nonceDevice: string;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
}

/**
 * Canonical, unambiguous transcript. Every field is base64url or hex (no `\n`), so newline-delimiting is a
 * lossless separator. Binds the identity ids (defense-in-depth), both fresh nonces (replay resistance), and
 * the sorted DTLS-fingerprint pair (MITM-relay resistance — the same binding B3 uses).
 */
function transcriptBytes(c: IReconnectChallenge): ArrayBuffer {
  const canonical = [
    'robota-reconnect/v1',
    c.deviceId,
    c.hostIdentityId,
    c.nonceHost,
    c.nonceDevice,
    sortedPair(c.localFingerprint, c.remoteFingerprint),
  ].join('\n');
  return ab(encoder.encode(canonical));
}

/** Sign the reconnect transcript with this side's private key → base64url signature. */
export async function signChallenge(
  privateKey: CryptoKey,
  challenge: IReconnectChallenge,
): Promise<string> {
  const signature = await webcrypto.subtle.sign(ECDSA_SIGN, privateKey, transcriptBytes(challenge));
  return toBase64Url(new Uint8Array(signature));
}

/** Verify a counterpart's reconnect signature against its pinned public key. Fail-closed on any error. */
export async function verifyChallenge(
  publicKey: CryptoKey,
  signature: string,
  challenge: IReconnectChallenge,
): Promise<boolean> {
  try {
    return await webcrypto.subtle.verify(
      ECDSA_SIGN,
      publicKey,
      ab(fromBase64Url(signature)),
      transcriptBytes(challenge),
    );
  } catch {
    return false;
  }
}
