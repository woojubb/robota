/**
 * The user's master key: an Ed25519 key recomputed from a BIP39 recovery phrase and never stored.
 *
 * phrase ─(BIP39: NFKD, PBKDF2-HMAC-SHA512 ×2048)→ 64-byte seed
 *        ─(SLIP-0010 ed25519, path MASTER_KEY_DERIVATION_PATH)→ 32-byte private key
 *        ─(WebCrypto, non-extractable)→ CryptoKeyPair
 *
 * Standard derivations rather than a bespoke KDF, so the phrase can be checked against published
 * vectors and recovered by any conforming implementation. The master key exists only while a
 * signing key is certified, rotated or revoked; the day-to-day issuer is the signing key.
 */

import {
  entropyToMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

import { ab, encoder, randomBytes, webcrypto } from '../crypto-primitives.js';
import { exportSpki, keyIdOf } from './encoding.js';

/** Words in a recovery phrase — 256 bits of entropy plus an 8-bit checksum. */
export const RECOVERY_PHRASE_WORDS = 24;
const RECOVERY_ENTROPY_BYTES = 32;

/**
 * SLIP-0010 path of the master key: `m/7240'/0'` (every ed25519 SLIP-0010 index is hardened).
 * A dedicated first index keeps this key unrelated to any wallet key the same phrase might derive.
 */
export const MASTER_KEY_DERIVATION_PATH: readonly number[] = [7240, 0];

const HARDENED_OFFSET = 0x80000000;
const SLIP10_ED25519_CURVE_KEY = 'ed25519 seed';
const HALF = 32;

/** PKCS#8 wrapping of a 32-byte Ed25519 private key (RFC 8410), so WebCrypto can import a seed. */
const ED25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const WORDS = new Set(wordlist);

export type TRecoveryPhraseRejection = 'word-count' | 'unknown-word' | 'checksum';

export type TRecoveryPhraseVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: TRecoveryPhraseRejection };

/** Lowercase, NFKD, single-spaced — the form a phrase is checked and derived in. */
function normalizePhrase(phrase: string): string {
  return phrase.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');
}

/** The phrase for exactly 256 bits of entropy. Exposed for the published vectors. */
export function recoveryPhraseFromEntropy(entropy: Uint8Array): string {
  if (entropy.length !== RECOVERY_ENTROPY_BYTES) {
    throw new Error(`recovery phrase: entropy must be ${RECOVERY_ENTROPY_BYTES} bytes`);
  }
  return entropyToMnemonic(entropy, wordlist);
}

/** A fresh 24-word phrase from 256 bits of CSPRNG entropy. */
export function generateRecoveryPhrase(): string {
  const entropy = randomBytes(RECOVERY_ENTROPY_BYTES);
  try {
    return recoveryPhraseFromEntropy(entropy);
  } finally {
    entropy.fill(0);
  }
}

/**
 * Whether `word` is one word of the recovery-phrase list, so a phrase typed one word at a time can be
 * checked word by word. A single word only: it says nothing about any phrase it belongs to.
 */
export function isRecoveryPhraseWord(word: string): boolean {
  if (typeof word !== 'string') return false;
  const normalized = word.normalize('NFKD').trim().toLowerCase();
  return !/\s/.test(normalized) && WORDS.has(normalized);
}

/** Whether `phrase` is a well-formed 24-word English phrase. The verdict never repeats a word. */
export function validateRecoveryPhrase(phrase: string): TRecoveryPhraseVerdict {
  if (typeof phrase !== 'string') return { ok: false, reason: 'word-count' };
  const normalized = normalizePhrase(phrase);
  const words = normalized.split(' ');
  if (words.length !== RECOVERY_PHRASE_WORDS) return { ok: false, reason: 'word-count' };
  if (!words.every((word) => WORDS.has(word))) return { ok: false, reason: 'unknown-word' };
  if (!validateMnemonic(normalized, wordlist)) return { ok: false, reason: 'checksum' };
  return { ok: true };
}

/** The 64-byte BIP39 seed of a valid phrase. Throws, naming only the reason, on an invalid one. */
export async function recoveryPhraseToSeed(phrase: string, passphrase = ''): Promise<Uint8Array> {
  const verdict = validateRecoveryPhrase(phrase);
  if (!verdict.ok) throw new Error(`recovery phrase invalid: ${verdict.reason}`);
  return mnemonicToSeed(normalizePhrase(phrase), passphrase);
}

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const hmacKey = await webcrypto.subtle.importKey(
    'raw',
    ab(key),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  return new Uint8Array(await webcrypto.subtle.sign('HMAC', hmacKey, ab(data)));
}

export interface ISlip10Node {
  readonly privateKey: Uint8Array;
  readonly chainCode: Uint8Array;
}

/**
 * SLIP-0010 ed25519 derivation. `path` lists indexes below 2^31; each is used hardened, the only
 * kind ed25519 defines.
 */
export async function deriveSlip10Ed25519(
  seed: Uint8Array,
  path: readonly number[],
): Promise<ISlip10Node> {
  let digest = await hmacSha512(encoder.encode(SLIP10_ED25519_CURVE_KEY), seed);
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
      digest.fill(0);
      throw new Error('slip-0010: path index out of range');
    }
    const data = new Uint8Array(1 + HALF + 4);
    data.set(digest.subarray(0, HALF), 1);
    new DataView(data.buffer).setUint32(1 + HALF, index + HARDENED_OFFSET);
    const next = await hmacSha512(digest.subarray(HALF), data);
    data.fill(0);
    digest.fill(0);
    digest = next;
  }
  const node = { privateKey: digest.slice(0, HALF), chainCode: digest.slice(HALF) };
  digest.fill(0);
  return node;
}

/** An Ed25519 WebCrypto keypair from a 32-byte private key, and its raw 32-byte public key. */
export async function ed25519KeyPairFromSeed(
  seed: Uint8Array,
  extractable = false,
): Promise<{ readonly keyPair: CryptoKeyPair; readonly publicKeyRaw: Uint8Array }> {
  if (seed.length !== HALF) throw new Error('ed25519: private key must be 32 bytes');
  const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + HALF);
  pkcs8.set(ED25519_PKCS8_PREFIX);
  pkcs8.set(seed, ED25519_PKCS8_PREFIX.length);
  try {
    // WebCrypto derives no public key from a private one, so read it once from a transient
    // extractable handle; the key the caller receives is imported separately.
    const transient = await webcrypto.subtle.importKey('pkcs8', ab(pkcs8), 'Ed25519', true, [
      'sign',
    ]);
    const jwk = await webcrypto.subtle.exportKey('jwk', transient);
    if (typeof jwk.x !== 'string') throw new Error('ed25519: public key unavailable');
    const standard = jwk.x.replace(/-/g, '+').replace(/_/g, '/');
    const publicKeyRaw = Uint8Array.from(
      atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')),
      (c) => c.charCodeAt(0),
    );
    const [privateKey, publicKey] = await Promise.all([
      webcrypto.subtle.importKey('pkcs8', ab(pkcs8), 'Ed25519', extractable, ['sign']),
      webcrypto.subtle.importKey('raw', ab(publicKeyRaw), 'Ed25519', true, ['verify']),
    ]);
    return { keyPair: { privateKey, publicKey }, publicKeyRaw };
  } finally {
    pkcs8.fill(0);
  }
}

export interface IMasterKey {
  /** base64url `SHA-256(SPKI)` of the master public key — the user's stable id. */
  readonly userId: string;
  /** base64url SPKI of the master public key, the value every device pins. */
  readonly publicKey: string;
  /** The private key is non-extractable: it can sign, and cannot be written anywhere. */
  readonly keyPair: CryptoKeyPair;
}

/** Recompute the master key from the recovery phrase (and optional BIP39 passphrase). */
export async function deriveMasterKey(phrase: string, passphrase = ''): Promise<IMasterKey> {
  const seed = await recoveryPhraseToSeed(phrase, passphrase);
  const node = await deriveSlip10Ed25519(seed, MASTER_KEY_DERIVATION_PATH);
  seed.fill(0);
  try {
    const { keyPair } = await ed25519KeyPairFromSeed(node.privateKey, false);
    return {
      userId: await keyIdOf(keyPair.publicKey),
      publicKey: await exportSpki(keyPair.publicKey),
      keyPair,
    };
  } finally {
    node.privateKey.fill(0);
    node.chainCode.fill(0);
  }
}
