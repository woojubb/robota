/**
 * Purpose-tagged canonical signatures — the one encoding every identity statement is signed in.
 *
 * Every signed structure's first field is `ctx: "robota/<purpose>/v<n>"`, and the signed bytes are
 * `JSON.stringify([ctx, ...fields])` over an explicit, per-structure field list. Putting the purpose
 * INSIDE the signed bytes is what makes a signature for one purpose worthless for every other: the
 * same key signs certificates and revocations, and without the tag a statement of one kind could be
 * re-read as another whose fields happen to line up.
 *
 * Decoding here is pre-authentication: every helper checks type, encoding and length before any
 * crypto runs, and a failure names the field, never the value.
 */

import { ab, encoder, toBase64Url, webcrypto } from '../crypto-primitives.js';

/** Every purpose an identity signature may carry. A verifier refuses any `ctx` but its own. */
export const IDENTITY_PURPOSES = {
  signingKeyCert: 'robota/signing-key-cert/v1',
  deviceCert: 'robota/device-cert/v1',
  roster: 'robota/roster/v1',
  revocation: 'robota/revocation/v1',
  signingKeyRevocation: 'robota/signing-key-revocation/v1',
  sessionDesc: 'robota/session-desc/v1',
  handshake: 'robota/handshake/v1',
  enrollProof: 'robota/enroll-proof/v1',
  enrollRequest: 'robota/enroll-request/v1',
  enrollCommit: 'robota/enroll-commit/v1',
  enrollSas: 'robota/enroll-sas/v1',
} as const;

export type TIdentityPurpose = (typeof IDENTITY_PURPOSES)[keyof typeof IDENTITY_PURPOSES];

/**
 * Tolerance applied to every not-before and expiry comparison. Two devices of one user disagree
 * about the time by seconds, not hours; anything wider would stretch every validity window.
 */
export const IDENTITY_CLOCK_SKEW_MS = 2 * 60 * 1000;

/** A value in the canonical encoding. No objects: field order is the structure's explicit list. */
export type TCanonical = string | number | null | readonly TCanonical[];

/** The bytes a signature for `purpose` covers. */
export function canonicalBytes(
  purpose: TIdentityPurpose,
  fields: readonly TCanonical[],
): Uint8Array {
  return encoder.encode(JSON.stringify([purpose, ...fields]));
}

/** Signature algorithms a statement may be signed with. `ES256` is ECDSA P-256 over SHA-256. */
export type TSignatureAlg = 'Ed25519' | 'ES256';

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const ED25519 = { name: 'Ed25519' } as const;

function signParams(alg: TSignatureAlg): AlgorithmIdentifier | EcdsaParams {
  return alg === 'ES256' ? ECDSA_SHA256 : ED25519;
}

/** Which statement algorithm a WebCrypto key signs with, or undefined for any other key. */
export function signatureAlgOf(key: CryptoKey): TSignatureAlg | undefined {
  const algorithm = key.algorithm as EcKeyAlgorithm;
  if (algorithm.name === 'Ed25519') return 'Ed25519';
  if (algorithm.name === 'ECDSA' && algorithm.namedCurve === 'P-256') return 'ES256';
  return undefined;
}

/** Sign canonical bytes with an Ed25519 or ECDSA P-256 private key → base64url signature. */
export async function signCanonical(privateKey: CryptoKey, bytes: Uint8Array): Promise<string> {
  const alg = signatureAlgOf(privateKey);
  if (alg === undefined) throw new Error('identity signature: unsupported signing key algorithm');
  const signature = await webcrypto.subtle.sign(signParams(alg), privateKey, ab(bytes));
  return toBase64Url(new Uint8Array(signature));
}

/** Import a verified-shape SPKI for verification. Never throws. */
export async function importVerifyKey(
  alg: TSignatureAlg,
  spki: string,
): Promise<CryptoKey | undefined> {
  try {
    return await webcrypto.subtle.importKey(
      'spki',
      ab(decodeBase64Url(spki)),
      alg === 'ES256' ? ECDSA_P256 : ED25519,
      true,
      ['verify'],
    );
  } catch {
    // allow-fallback: a key that does not import verifies nothing — the caller reports signature-invalid
    return undefined;
  }
}

/** Verify a signature over canonical bytes. A throw anywhere is a failed verification. */
export async function verifyCanonical(
  publicKey: CryptoKey,
  signature: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const alg = signatureAlgOf(publicKey);
  if (alg === undefined) return false;
  try {
    return await webcrypto.subtle.verify(
      signParams(alg),
      publicKey,
      ab(decodeBase64Url(signature)),
      ab(bytes),
    );
  } catch {
    // allow-fallback: a verification that throws is a failed verification (false)
    return false;
  }
}

/** base64url `SHA-256(SPKI)` of a public key — the id form of users, signing keys and devices. */
export async function keyIdOf(publicKey: CryptoKey): Promise<string> {
  const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', publicKey));
  return keyIdOfSpki(spki);
}

export async function keyIdOfSpki(spki: Uint8Array): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', ab(spki));
  return toBase64Url(new Uint8Array(digest));
}

export async function exportSpki(publicKey: CryptoKey): Promise<string> {
  return toBase64Url(new Uint8Array(await webcrypto.subtle.exportKey('spki', publicKey)));
}

// ── Pre-auth decoding ────────────────────────────────────────────────────────────────────────────

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Decode base64url that is already known to match the alphabet. */
export function decodeBase64Url(value: string): Uint8Array {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * The bytes of a canonical base64url string of exactly `byteLength` bytes, or undefined.
 * Canonical means re-encoding gives the same text, so one byte string has exactly one spelling.
 */
export function canonicalBase64Url(value: unknown, byteLength: number): Uint8Array | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length !== Math.ceil((byteLength * 4) / 3)) return undefined;
  if (!BASE64URL.test(value)) return undefined;
  const bytes = decodeBase64Url(value);
  if (bytes.length !== byteLength || toBase64Url(bytes) !== value) return undefined;
  return bytes;
}

/** Why a structure failed decoding. `field` names what failed; the value is never repeated. */
export interface IDecodeFailure {
  readonly ok: false;
  readonly reason: 'malformed' | 'wrong-purpose';
  readonly field: string;
}

export type TDecoded<T> = { readonly ok: true; readonly value: T } | IDecodeFailure;

export function malformed(field: string): IDecodeFailure {
  return { ok: false, reason: 'malformed', field };
}

/**
 * Open a candidate statement: a plain object whose `ctx` is `purpose` and whose own keys are
 * exactly `required` plus any of `optional`. Extra keys are refused so nothing unsigned travels
 * alongside a signature looking as if it were covered by it.
 */
export function openStatement(
  value: unknown,
  purpose: TIdentityPurpose,
  required: readonly string[],
  optional: readonly string[] = [],
): TDecoded<Readonly<Record<string, unknown>>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return malformed('statement');
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return malformed('statement');
  const record = value as Record<string, unknown>;
  const ctx = Object.prototype.hasOwnProperty.call(record, 'ctx') ? record['ctx'] : undefined;
  if (typeof ctx !== 'string') return malformed('ctx');
  if (ctx !== purpose) return { ok: false, reason: 'wrong-purpose', field: 'ctx' };
  const keys = Object.keys(record);
  const allowed = new Set(['ctx', ...required, ...optional]);
  for (const key of keys) if (!allowed.has(key)) return malformed('statement');
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return malformed(key);
  }
  return { ok: true, value: record };
}

/** SHA-256 ids (users, signing keys, devices) are 32 bytes. */
export const ID_BYTES = 32;
/** Ed25519 and ECDSA P-256 (IEEE P1363 r‖s) signatures are both 64 bytes. */
export const SIGNATURE_BYTES = 64;

export function isId(value: unknown): value is string {
  return canonicalBase64Url(value, ID_BYTES) !== undefined;
}

export function isSignature(value: unknown): value is string {
  return canonicalBase64Url(value, SIGNATURE_BYTES) !== undefined;
}

/** A millisecond timestamp or a sequence number: a non-negative safe integer. */
export function isCount(value: unknown): value is number {
  // -0 is refused: it serialises as 0, which would give one signature two spellings.
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
  );
}

/** The DER prefix of each SPKI shape accepted, and the key bytes that follow it. */
const SPKI_SHAPES = {
  Ed25519: { prefix: '302a300506032b6570032100', keyBytes: 32 },
  X25519: { prefix: '302a300506032b656e032100', keyBytes: 32 },
  // id-ecPublicKey, prime256v1, BIT STRING of an uncompressed point (0x04 ‖ X ‖ Y).
  P256: { prefix: '3059301306072a8648ce3d020106082a8648ce3d030107034200', keyBytes: 65 },
} as const;

export type TSpkiShape = keyof typeof SPKI_SHAPES;

const UNCOMPRESSED_POINT = 0x04;

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A canonical base64url SPKI of exactly the given key shape. */
export function isSpki(value: unknown, shape: TSpkiShape): value is string {
  const { prefix, keyBytes } = SPKI_SHAPES[shape];
  const bytes = canonicalBase64Url(value, prefix.length / 2 + keyBytes);
  if (bytes === undefined) return false;
  if (hexOf(bytes.subarray(0, prefix.length / 2)) !== prefix) return false;
  return shape !== 'P256' || bytes[prefix.length / 2] === UNCOMPRESSED_POINT;
}

/** Strictly ascending (so sorted and duplicate-free) ids, at most `max` of them. */
export function isSortedIdSet(value: unknown, max: number): value is readonly string[] {
  if (!Array.isArray(value) || value.length > max) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!isId(value[i])) return false;
    if (i > 0 && !((value[i - 1] as string) < (value[i] as string))) return false;
  }
  return true;
}

/** Sort and deduplicate for issuance, so every statement has one canonical member order. */
export function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

/** Seconds-scale time windows, expressed once. */
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
