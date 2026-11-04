/**
 * Hashing and randomness from the platform, not from Node.
 *
 * `node:crypto` is not available to a platform-neutral entry (ARCHITECTURE.md "Runtime platforms"),
 * and Web Crypto's `subtle.digest` is asynchronous. These are the synchronous digest and the secure
 * random bytes the neutral packages need, so none of them reaches for a host.
 */
import jsSHA from 'jssha';

/**
 * Strings are encoded here rather than by jsSHA's `TEXT` input, which pairs a lone surrogate with the
 * next character: `TextEncoder` writes U+FFFD for it, as `node:crypto` does, so two different
 * strings never hash alike.
 */
const utf8 = new TextEncoder();

/** SHA-256 of a string (hashed as UTF-8) or raw bytes, as lowercase hex. */
export function sha256Hex(input: string | Uint8Array): string {
  const digest = new jsSHA('SHA-256', 'UINT8ARRAY');
  digest.update(typeof input === 'string' ? utf8.encode(input) : input);
  return digest.getHash('HEX');
}

/**
 * SHA-1 of a string (hashed as UTF-8) or raw bytes, as lowercase hex. For a digest that names
 * something and must stay equal to the one an earlier run wrote, never for a secret or a signature.
 */
export function sha1Hex(input: string | Uint8Array): string {
  const digest = new jsSHA('SHA-1', 'UINT8ARRAY');
  digest.update(typeof input === 'string' ? utf8.encode(input) : input);
  return digest.getHash('HEX');
}

/** HMAC-SHA-256 of `text` under `key` (both UTF-8), as lowercase hex. */
export function hmacSha256Hex(key: string, text: string): string {
  const digest = new jsSHA('SHA-256', 'UINT8ARRAY', {
    hmacKey: { value: utf8.encode(key), format: 'UINT8ARRAY' },
  });
  digest.update(utf8.encode(text));
  return digest.getHash('HEX');
}

/**
 * `byteLength` secure random bytes as lowercase hex. Like `randomId`, it throws rather than falling
 * back to `Math.random` when the platform has no cryptographic randomness.
 */
export function randomHex(byteLength: number): string {
  const platformCrypto = globalThis.crypto as Crypto | undefined;
  if (typeof platformCrypto?.getRandomValues !== 'function') {
    throw new Error(
      'No cryptographic randomness is available on this platform (globalThis.crypto is missing ' +
        'getRandomValues), so random bytes cannot be generated. This is not something to ' +
        'substitute Math.random for.',
    );
  }
  const bytes = platformCrypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether two strings are equal, taking the same time for any two strings of one length so a
 * comparison of a secret does not reveal how many leading characters matched. Unequal lengths
 * return early: the length of a token or digest is not itself a secret.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
