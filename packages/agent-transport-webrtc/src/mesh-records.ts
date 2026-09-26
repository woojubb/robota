/**
 * Signed, encrypted rendezvous records as public infrastructure stores them: BEP 44 mutable items
 * (and their pkarr form) under a one-time key per pair, direction, epoch and purpose.
 *
 * Nothing here names a device, a user or the product. The key and salt rotate every epoch and differ
 * per direction; the value is the pair's AEAD ciphertext, padded to a fixed size so its length says
 * nothing about what it holds. Whoever stores or serves a record can check its signature, and only
 * the pair can open it. Isomorphic: WebCrypto only.
 */
import type {
  IPairRendezvous,
  TRendezvousDirection,
  TRendezvousRecordPurpose,
  TRendezvousTagPurpose,
} from '@robota-sdk/agent-remote-pairing';

import type { IMeshCandidate } from './mesh-discovery.js';

/** BEP 44: a value is less than 1000 bytes. */
export const BEP44_MAX_VALUE_BYTES = 999;
/** BEP 44: a salt is at most 64 bytes. */
const BEP44_MAX_SALT_BYTES = 64;
/** Plaintext size every connection-hints record is padded to. */
export const HINTS_PADDED_BYTES = 640;
/** Plaintext size every device-lists record is padded to; the pkarr form must still fit. */
export const LISTS_PADDED_BYTES = 864;
/** Addresses one hints record carries. */
export const MAX_HINT_CANDIDATES = 8;
const MAX_HOST_CHARS = 64;

const ED25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function ab(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function base64UrlToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** A one-time Ed25519 key: the public half, and a signer. */
export interface IItemKey {
  readonly publicKey: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** The Ed25519 key whose private key is `seed`. */
export async function ed25519FromSeed(seed: Uint8Array): Promise<IItemKey> {
  if (seed.length !== 32) throw new Error('an Ed25519 seed is 32 bytes');
  const privateKey = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    ab(concatBytes([ED25519_PKCS8_PREFIX, seed])),
    { name: 'Ed25519' },
    true,
    ['sign'],
  );
  const jwk = await globalThis.crypto.subtle.exportKey('jwk', privateKey);
  if (typeof jwk.x !== 'string') throw new Error('Ed25519 public key unavailable');
  const publicKey = base64UrlToBytes(jwk.x);
  return {
    publicKey,
    sign: async (message) =>
      new Uint8Array(
        await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, privateKey, ab(message)),
      ),
  };
}

/** Whether `signature` is `publicKey`'s Ed25519 signature of `message`. Never throws. */
export async function verifyEd25519(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      ab(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      ab(signature),
      ab(message),
    );
  } catch {
    // allow-fallback: a key or signature that cannot be read verifies nothing
    return false;
  }
}

/** A BEP 44 mutable item, as signed. */
export interface IMutableItem {
  readonly k: Uint8Array;
  readonly salt?: Uint8Array;
  readonly seq: number;
  readonly v: Uint8Array;
  readonly sig: Uint8Array;
}

/** The bytes a BEP 44 signature covers: `[4:salt…]3:seqi…e1:v…` with `v` as a byte string. */
export function bep44SignedBytes(
  salt: Uint8Array | undefined,
  seq: number,
  v: Uint8Array,
): Uint8Array {
  const parts: Uint8Array[] = [];
  if (salt !== undefined && salt.length > 0) {
    parts.push(encoder.encode(`4:salt${salt.length}:`), salt);
  }
  parts.push(encoder.encode(`3:seqi${seq}e1:v${v.length}:`), v);
  return concatBytes(parts);
}

/** Sign `v` as a mutable item under `key` and `salt`. */
export async function signMutableItem(
  key: IItemKey,
  salt: Uint8Array | undefined,
  seq: number,
  v: Uint8Array,
): Promise<IMutableItem> {
  if (v.length > BEP44_MAX_VALUE_BYTES) throw new Error('record value exceeds 999 bytes');
  if (salt !== undefined && salt.length > BEP44_MAX_SALT_BYTES)
    throw new Error('salt exceeds 64 bytes');
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('seq must be a non-negative integer');
  const sig = await key.sign(bep44SignedBytes(salt, seq, v));
  return { k: key.publicKey, ...(salt !== undefined ? { salt } : {}), seq, v, sig };
}

/** Whether `item` is signed by `publicKey` under exactly `salt`. Never throws. */
export async function verifyMutableItem(
  item: IMutableItem,
  publicKey: Uint8Array,
  salt: Uint8Array | undefined,
): Promise<boolean> {
  if (!bytesEqual(item.k, publicKey)) return false;
  const itemSalt = item.salt ?? new Uint8Array(0);
  if (!bytesEqual(itemSalt, salt ?? new Uint8Array(0))) return false;
  if (item.v.length > BEP44_MAX_VALUE_BYTES) return false;
  if (!Number.isSafeInteger(item.seq) || item.seq < 0) return false;
  return verifyEd25519(publicKey, bep44SignedBytes(salt, item.seq, item.v), item.sig);
}

/** Where one pair's record of one purpose lives in one direction at one epoch. */
export interface IItemAddress {
  readonly key: IItemKey;
  readonly salt: Uint8Array;
}

const SALT_PURPOSE: Record<Exclude<TRendezvousRecordPurpose, 'signal'>, TRendezvousTagPurpose> = {
  hints: 'bep44-salt',
  revocation: 'bep44-revocation-salt',
};

/** The address of `purpose`'s record in `direction` at `epoch`. */
export async function itemAddress(
  rendezvous: IPairRendezvous,
  purpose: Exclude<TRendezvousRecordPurpose, 'signal'>,
  direction: TRendezvousDirection,
  epoch: number,
): Promise<IItemAddress> {
  const [seed, salt] = await Promise.all([
    rendezvous.signingSeed(direction, epoch, purpose),
    rendezvous.tag(SALT_PURPOSE[purpose], direction, epoch),
  ]);
  return { key: await ed25519FromSeed(seed), salt };
}

/** `data` padded with trailing spaces to exactly `size` bytes; throws when it does not fit. */
export function padJson(value: unknown, size: number): Uint8Array {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.length > size) throw new Error('record does not fit its fixed size');
  const out = new Uint8Array(size).fill(0x20);
  out.set(bytes);
  return out;
}

/** Parse padded JSON; `undefined` when it is not JSON. */
export function unpadJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** Connection hints: where the peer's direct signaling endpoint might be reached. */
export function encodeHints(candidates: readonly IMeshCandidate[]): Uint8Array {
  const kept: [string, number][] = [];
  for (const c of candidates) {
    if (kept.length >= MAX_HINT_CANDIDATES) break;
    if (c.host.length === 0 || c.host.length > MAX_HOST_CHARS) continue;
    kept.push([c.host, c.port]);
  }
  return padJson({ v: 1, c: kept }, HINTS_PADDED_BYTES);
}

const HOST = /^[0-9A-Za-z.:%_-]{1,64}$/;

/** The candidates of a hints record; hostile input, so anything malformed is dropped. */
export function decodeHints(bytes: Uint8Array): IMeshCandidate[] {
  const value = unpadJson(bytes);
  if (typeof value !== 'object' || value === null) return [];
  const r = value as { v?: unknown; c?: unknown };
  if (r.v !== 1 || !Array.isArray(r.c)) return [];
  const out: IMeshCandidate[] = [];
  for (const entry of r.c.slice(0, MAX_HINT_CANDIDATES)) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [host, port] = entry as [unknown, unknown];
    if (typeof host !== 'string' || !HOST.test(host)) continue;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) continue;
    out.push({ host, port });
  }
  return out;
}

/**
 * A publish delay in `[0, maxMs]`, so the records one device publishes for its pairs do not all
 * appear at once and cannot be linked by their timing.
 */
export function publishJitter(maxMs: number, random: () => number = Math.random): number {
  const r = random();
  const unit = Number.isFinite(r) ? Math.min(Math.max(r, 0), 1) : 0;
  return Math.floor(unit * Math.max(0, maxMs));
}
