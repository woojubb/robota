import type { IIdentityContext } from './identity/crypto-context.js';
/**
 * Reconnect rendezvous derivation for session-resume (REMOTE-013 Stage E4).
 *
 * **Isomorphic** (WebCrypto HKDF only). The E2-hardened relay is single-use + half-open-evicting, so a
 * reconnect cannot reuse the first-pair room. Instead both peers deterministically compute a **fresh** room
 * per reconnect from a per-device seed + a monotonic counter:
 *
 * - `reconnectSeed = HKDF(sessionKey, "seed")` — the E4 use the per-pairing `sessionKey` was reserved for.
 *   Because each pairing has its own `sessionKey`, the seed is PER-DEVICE: a revoked device's seed derives
 *   only its own (now-defunct) rooms, so it cannot squat another device's reconnect rooms.
 * - `rendezvous = HKDF(reconnectSeed, "rv" ‖ counter)` — a fresh single-use room per confirmed reconnect
 *   (counter advances resync-on-success). No wall clock ⇒ no skew; seed+counter persist ⇒ works cold.
 */
import { ab, fromBase64Url, toBase64Url, webcrypto } from './crypto-primitives.js';

const encoder = new TextEncoder();
/** Fixed, non-secret HKDF salt (shared by host + browser so derivations match). */

async function hkdf(
  cryptoContext: IIdentityContext,
  keyMaterial: Uint8Array,
  info: Uint8Array,
  bits = 256,
): Promise<Uint8Array> {
  const base = await webcrypto.subtle.importKey('raw', ab(keyMaterial), 'HKDF', false, [
    'deriveBits',
  ]);
  const derived = await webcrypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: ab(encoder.encode(`${cryptoContext.namespace}-remote-reconnect/v1`)),
      info: ab(info),
    },
    base,
    bits,
  );
  return new Uint8Array(derived);
}

/**
 * Derive the per-device reconnect seed from the pairing `sessionKey` (base64url). Persisted by BOTH peers at
 * first-pair accept (host trusted-device record, browser credential). Base64url output.
 */
export async function deriveReconnectSeed(
  cryptoContext: IIdentityContext,
  sessionKey: string,
): Promise<string> {
  return toBase64Url(
    await hkdf(
      cryptoContext,
      fromBase64Url(sessionKey),
      encoder.encode(`${cryptoContext.namespace}-reconnect-seed/v1`),
    ),
  );
}

/**
 * Derive the reconnect rendezvous id for a given counter (base64url). Both peers compute the identical value;
 * a fresh room per counter keeps the single-use relay happy. `counter` must be a non-negative integer.
 */
export async function deriveReconnectRendezvous(
  cryptoContext: IIdentityContext,
  reconnectSeed: string,
  counter: number,
): Promise<string> {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error(
      `deriveReconnectRendezvous: counter must be a non-negative integer, got ${counter}`,
    );
  }
  const info = encoder.encode(`${cryptoContext.namespace}-reconnect-rv/v1:` + counter.toString());
  return toBase64Url(await hkdf(cryptoContext, fromBase64Url(reconnectSeed), info));
}
