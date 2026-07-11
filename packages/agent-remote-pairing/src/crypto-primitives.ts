/**
 * Shared low-level crypto primitives for the remote-pairing package (extracted for SSOT between the B3
 * pairing handshake and the E3 device-identity / reconnect layer). **Isomorphic**: WebCrypto + standard web
 * APIs only (`globalThis.crypto`, `btoa`/`atob`, `TextEncoder`) — no `node:` imports, no workspace deps — so
 * the same code runs on the Node host (agent-cli, Node 22) and the browser remote client.
 */

export const webcrypto: Crypto = globalThis.crypto;
export const encoder = new TextEncoder();

// ── base64url (isomorphic via btoa/atob, present in Node 22 + browsers) ──────────────────────────

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return bytes;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Normalize a byte view to a standalone `ArrayBuffer` (a `BufferSource` WebCrypto accepts across TS lib versions). */
export function ab(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** Deterministic, order-independent join of two fingerprints — the channel-binding value both peers compute. */
export function sortedPair(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}
