/**
 * A random identifier, from the platform rather than from Node. CORE-028.
 *
 * Five modules in this package imported `randomUUID` from `node:crypto`, and this package ships a
 * `browser` export condition — so the first line of the browser bundle was
 * `import{randomUUID}from"node:crypto"`. `apps/agent-web` carries webpack aliases and two
 * hand-written stub modules that exist only to patch around that.
 *
 * `globalThis.crypto.randomUUID()` is the same function in both places: Web Crypto in the browser,
 * and a global in Node since 19 (verified on 22.14). Nothing is lost by asking the platform.
 *
 * The fallback is NOT a silent one. `crypto.randomUUID` requires a SECURE CONTEXT in browsers, so a
 * page served over plain HTTP has `crypto` but not the method — and an id generator that throws
 * there would take the whole session with it. The replacement is a v4 UUID built from
 * `getRandomValues`, which needs no secure context and is the same quality of randomness; only if
 * even that is missing does this throw, because at that point there is no randomness to be had and
 * inventing some with `Math.random` would be worse than failing.
 */
export function randomId(): string {
  const platformCrypto = globalThis.crypto as Crypto | undefined;
  if (typeof platformCrypto?.randomUUID === 'function') {
    return platformCrypto.randomUUID();
  }
  if (typeof platformCrypto?.getRandomValues === 'function') {
    const bytes = platformCrypto.getRandomValues(new Uint8Array(16));
    // RFC 4122 §4.4: set the version (4) and variant (10xx) bits.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error(
    'No cryptographic randomness is available on this platform (globalThis.crypto is missing both ' +
      'randomUUID and getRandomValues), so a unique identifier cannot be generated. This is not ' +
      'something to substitute Math.random for.',
  );
}
