/**
 * Pairing + DTLS-fingerprint channel binding (REMOTE-005 Stage B3).
 *
 * **Isomorphic**: uses ONLY WebCrypto (`globalThis.crypto` / `crypto.subtle`) + standard web APIs, so the same
 * module runs on the Node host (agent-cli, Node 22) and the Stage-D browser remote client — no `node:` imports,
 * no WebRTC implementation, no workspace deps.
 *
 * Security model: a high-entropy (256-bit) single-use pairing secret is transferred machine-to-machine (QR /
 * deep link). Because it is high-entropy, no PAKE is needed (a PAKE only protects a low-entropy secret from
 * brute-force). Authentication + MITM-relay detection is a **directional HMAC key-confirmation bound to both DTLS
 * fingerprints**: each peer confirms it observes the SAME DTLS channel the other does. A relay that substitutes a
 * DTLS fingerprint (the DTLS layer only accepts a certificate matching the advertised fingerprint whose key signed
 * the handshake, so a relay can only present its own) makes the two peers' fingerprint pairs differ → the confirmation fails. The confirmation is
 * **directional** (`LABEL_INITIATOR ≠ LABEL_RESPONDER`) and **nonce-bound**, so a secretless relay cannot reflect
 * a peer's own confirmation back to it, nor replay one across handshakes.
 */

import {
  ab,
  concat,
  encoder,
  fromBase64Url,
  randomBytes,
  sortedPair,
  toBase64Url,
  webcrypto,
} from './crypto-primitives.js';

/** Fixed, non-secret HKDF salt (v1). Host and browser MUST use the identical salt/info to derive matching keys. */
const HKDF_SALT = encoder.encode('robota-remote-pairing/v1');
const CONFIRM_INFO = encoder.encode('confirm');
const SESSION_INFO = encoder.encode('session');

const SECRET_BYTES = 32; // 256-bit pairing secret
const RENDEZVOUS_BYTES = 16; // 128-bit rendezvous id
const NONCE_BYTES = 16;

export type TPairingRole = 'initiator' | 'responder';

const ROLE_LABEL: Record<TPairingRole, Uint8Array> = {
  initiator: encoder.encode('robota-pairing/initiator'),
  responder: encoder.encode('robota-pairing/responder'),
};

export interface IPairingSecret {
  /** Rendezvous id (relay meeting point) — may be shared with the signaling server. */
  readonly rendezvous: string;
  /** High-entropy pairing secret — carried in the URL fragment, NEVER sent to any server. */
  readonly secret: string;
}

// ── secret + rendezvous + nonce ─────────────────────────────────────────────────────────────────

/** Generate a fresh 256-bit pairing secret + a distinct 128-bit rendezvous id (both URL-safe base64url). */
export function generatePairingSecret(): IPairingSecret {
  return {
    secret: toBase64Url(randomBytes(SECRET_BYTES)),
    rendezvous: toBase64Url(randomBytes(RENDEZVOUS_BYTES)),
  };
}

/** Generate a fresh per-handshake nonce (base64url). */
export function generateNonce(): string {
  return toBase64Url(randomBytes(NONCE_BYTES));
}

// ── pairing URL (secret lives in the fragment) ──────────────────────────────────────────────────

/** Encode `{ rendezvous, secret }` into `baseUrl`'s **fragment** (never sent to the page's server). */
export function toPairingUrl(baseUrl: string, pairing: IPairingSecret): string {
  const url = new URL(baseUrl);
  const params = new URLSearchParams();
  params.set('r', pairing.rendezvous);
  params.set('s', pairing.secret);
  url.hash = params.toString();
  return url.toString();
}

/** Parse a pairing URL, reading the secret + rendezvous from the fragment. Throws if either is missing. */
export function parsePairingUrl(url: string): IPairingSecret {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const rendezvous = params.get('r');
  const secret = params.get('s');
  if (!rendezvous || !secret) {
    throw new Error('invalid pairing URL: missing rendezvous (r) or secret (s) in fragment');
  }
  return { rendezvous, secret };
}

// ── DTLS fingerprint extraction ─────────────────────────────────────────────────────────────────

/** One DTLS fingerprint attribute: the hash algorithm (lower-case) and the value (upper-case hex pairs). */
export interface IDtlsFingerprint {
  readonly algorithm: string;
  readonly value: string;
}

/**
 * Anything an SDP parser might read as a fingerprint attribute: leading blanks, blanks around `=` and `:`, any
 * case. Every such line must also be a strict attribute, so a looser parser than ours cannot see a fingerprint
 * this function did not.
 */
const LOOSE_FINGERPRINT_LINE = /^[ \t]*a[ \t]*=[ \t]*fingerprint[ \t]*:([^\r\n]*)/gim;
const STRICT_FINGERPRINT_VALUE = /^(\S+)[ \t]+([0-9A-Fa-f:]+)[ \t]*$/;

/**
 * Read THE DTLS fingerprint of an SDP. Throws unless the SDP carries exactly one fingerprint (fail closed).
 *
 * **Exactly one, because the binding must name the certificate the DTLS stack verified.** A DTLS stack accepts
 * the peer's certificate when it matches ANY advertised fingerprint, so an SDP with two different fingerprints
 * lets the certificate that was verified differ from the value a caller would bind. Repeating the SAME value
 * (one per m-section) is harmless and accepted; two different values are refused, and so is a line that some
 * parser could read as a fingerprint but that is not exactly `a=fingerprint:<hash> <value>`.
 *
 * **Anchored to the start of an SDP line, never crossing one.** Only line starts can begin a match, which keeps
 * the scan linear in the SDP length (the SDP arrives before any authentication), and an `a=fingerprint:`
 * appearing mid-line — inside another field's free text that no DTLS stack reads — is never an attribute.
 */
export function extractDtlsFingerprintAttribute(sdp: string): IDtlsFingerprint {
  let found: IDtlsFingerprint | undefined;
  for (const match of sdp.matchAll(LOOSE_FINGERPRINT_LINE)) {
    const strict = match[0].startsWith('a=fingerprint:') ? STRICT_FINGERPRINT_VALUE.exec(match[1]) : null;
    if (!strict) throw new Error('SDP carries a malformed DTLS fingerprint attribute');
    const attribute = { algorithm: strict[1].toLowerCase(), value: strict[2].toUpperCase() };
    if (found && (found.algorithm !== attribute.algorithm || found.value !== attribute.value)) {
      throw new Error('SDP advertises more than one DTLS fingerprint');
    }
    found = attribute;
  }
  if (!found) throw new Error('no DTLS fingerprint (a=fingerprint) found in SDP');
  return found;
}

/** The value of THE DTLS fingerprint of an SDP — see {@link extractDtlsFingerprintAttribute}. */
export function extractDtlsFingerprint(sdp: string): string {
  return extractDtlsFingerprintAttribute(sdp).value;
}

// ── key derivation (HKDF; distinct info per purpose) ────────────────────────────────────────────

async function hkdfBits(secret: string, info: Uint8Array, bits = 256): Promise<Uint8Array> {
  const base = await webcrypto.subtle.importKey('raw', ab(fromBase64Url(secret)), 'HKDF', false, [
    'deriveBits',
  ]);
  const derived = await webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: ab(HKDF_SALT), info: ab(info) },
    base,
    bits,
  );
  return new Uint8Array(derived);
}

async function confirmationKey(secret: string): Promise<CryptoKey> {
  const bits = await hkdfBits(secret, CONFIRM_INFO);
  return webcrypto.subtle.importKey('raw', ab(bits), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
}

/**
 * Derive the Stage-E application session key from the pairing secret (distinct `info` from the confirmation key
 * → domain-separated). B3 exposes it; its USE (TOFU bootstrap / app-layer key) is Stage E.
 */
export async function deriveSessionKey(secret: string): Promise<string> {
  return toBase64Url(await hkdfBits(secret, SESSION_INFO));
}

// ── directional, nonce-bound channel confirmation ───────────────────────────────────────────────

async function confirmationFor(
  key: CryptoKey,
  role: TPairingRole,
  nonceInitiator: string,
  nonceResponder: string,
  fingerprintPair: string,
): Promise<string> {
  const transcript = concat([
    ROLE_LABEL[role],
    fromBase64Url(nonceInitiator),
    fromBase64Url(nonceResponder),
    encoder.encode(fingerprintPair),
  ]);
  const signature = await webcrypto.subtle.sign('HMAC', key, ab(transcript));
  return toBase64Url(new Uint8Array(signature));
}

export interface IConfirmationInput {
  readonly secret: string;
  /** This peer's role. Initiator ≡ the WebRTC offerer (fixed by signaling, not negotiable). */
  readonly role: TPairingRole;
  readonly nonceInitiator: string;
  readonly nonceResponder: string;
  /** This peer's own DTLS fingerprint (from its local SDP). */
  readonly localFingerprint: string;
  /** The remote DTLS fingerprint of the certificate the DTLS layer verified. */
  readonly remoteFingerprint: string;
}

/**
 * Compute this peer's outgoing confirmation (under its OWN role label) and the value it must receive from the
 * counterpart (under the PEER's role label). Because the two role labels differ, the value a peer expects to
 * receive ≠ the value it sends — so a secretless relay cannot reflect a peer's own confirmation back to it.
 */
export async function computeConfirmations(
  input: IConfirmationInput,
): Promise<{ send: string; expectPeer: string }> {
  const key = await confirmationKey(input.secret);
  const pair = sortedPair(input.localFingerprint, input.remoteFingerprint);
  const peerRole: TPairingRole = input.role === 'initiator' ? 'responder' : 'initiator';
  const send = await confirmationFor(
    key,
    input.role,
    input.nonceInitiator,
    input.nonceResponder,
    pair,
  );
  const expectPeer = await confirmationFor(
    key,
    peerRole,
    input.nonceInitiator,
    input.nonceResponder,
    pair,
  );
  return { send, expectPeer };
}

/**
 * Isomorphic timing-safe equality of two confirmation strings. Both operands are MAC'd under a fresh ephemeral
 * key (double-HMAC) so the subsequent byte comparison reveals nothing to a timing observer — avoids the
 * `node:`-only `crypto.timingSafeEqual`.
 */
export async function verifyPeerConfirmation(expected: string, received: string): Promise<boolean> {
  const ephemeral = await webcrypto.subtle.importKey(
    'raw',
    ab(randomBytes(32)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const a = new Uint8Array(
    await webcrypto.subtle.sign('HMAC', ephemeral, ab(encoder.encode(expected))),
  );
  const b = new Uint8Array(
    await webcrypto.subtle.sign('HMAC', ephemeral, ab(encoder.encode(received))),
  );
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
