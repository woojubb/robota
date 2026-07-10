/**
 * Pairing + DTLS-fingerprint channel binding (REMOTE-005 Stage B3).
 *
 * **Isomorphic**: uses ONLY WebCrypto (`globalThis.crypto` / `crypto.subtle`) + standard web APIs, so the same
 * module runs on the Node host (agent-cli, Node 22) and the Stage-D browser remote client — no `node:` imports,
 * no werift, no workspace deps.
 *
 * Security model: a high-entropy (256-bit) single-use pairing secret is transferred machine-to-machine (QR /
 * deep link). Because it is high-entropy, no PAKE is needed (a PAKE only protects a low-entropy secret from
 * brute-force). Authentication + MITM-relay detection is a **directional HMAC key-confirmation bound to both DTLS
 * fingerprints**: each peer confirms it observes the SAME DTLS channel the other does. A relay that substitutes a
 * DTLS fingerprint (werift's `verifyRemoteCertificateFingerprint` forces its advertised fingerprint to match its
 * own cert) makes the two peers' fingerprint pairs differ → the confirmation fails. The confirmation is
 * **directional** (`LABEL_INITIATOR ≠ LABEL_RESPONDER`) and **nonce-bound**, so a secretless relay cannot reflect
 * a peer's own confirmation back to it, nor replay one across handshakes.
 */

const webcrypto: Crypto = globalThis.crypto;
const encoder = new TextEncoder();

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

// ── base64url (isomorphic via btoa/atob, present in Node 22 + browsers) ──────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
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
function ab(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
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

/** Extract the `a=fingerprint:<hash> <value>` value from an SDP. Throws if absent (fail closed). */
export function extractDtlsFingerprint(sdp: string): string {
  const match = sdp.match(/a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/);
  if (!match) throw new Error('no DTLS fingerprint (a=fingerprint) found in SDP');
  return match[1].toUpperCase();
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

function sortedPair(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

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
  /** The remote DTLS fingerprint from the SDP werift consumed + verified. */
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
