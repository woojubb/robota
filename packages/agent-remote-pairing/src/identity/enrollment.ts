/**
 * Enrolling a new device from a one-time code: the new device ("joiner") proves it holds the code the
 * operator read off an existing device, over the channel both negotiated, before anything else is
 * said. Transport-agnostic (`send` + `onFrame`), like the pairing and device handshakes.
 *
 * - **The code** is 125 random bits in Crockford base32, typed by a person. Everything is derived
 *   from it with HKDF under distinct labels: the two relay topics (one per direction) and the keys of
 *   the proof and of the short authentication string. A relay sees a topic, which gives no way back to
 *   the code; guessing the code online means guessing the topic too.
 * - **The proof** is the pairing pattern: fresh nonces, then a MAC under the code's key over both
 *   negotiated DTLS fingerprints, both nonces and the sender's role. A relay that terminates DTLS on
 *   both sides makes the two sides see different fingerprints, so neither proof verifies; the sender's
 *   role inside the MAC makes a reflected proof fail.
 * - **The request** names the joiner's public keys and is signed with its new device key over the
 *   proven binding, so the key the existing device certifies is the one on the other end of this
 *   channel.
 * - **The short authentication string** is the defence against someone who has seen the code, who
 *   passes the proof like the operator's own device. It covers the binding, the request, the master
 *   public key the existing device announced, and a random contribution from each side. The joiner
 *   commits to its contribution with the request and opens it only after the existing device has
 *   revealed its own, the numeric-comparison pattern: nobody in the middle can choose a part after
 *   seeing the other, so the two screens show the same digits only when both sides talk to each
 *   other. Both operators compare them and both say yes: the joiner pins no master key, and the
 *   existing device certifies no device, on the other side's word alone.
 */

import { ab, encoder, randomBytes, toBase64Url, webcrypto } from '../crypto-primitives.js';
import {
  decodeDeviceCertificate,
  decodeSigningKeyCertificate,
  isDeviceName,
  type IDeviceCertificate,
  type ISigningKeyCertificate,
} from './certificates.js';
import {
  IDENTITY_PURPOSES,
  canonicalBase64Url,
  canonicalBytes,
  decodeBase64Url,
  importVerifyKey,
  isId,
  isSignature,
  isSpki,
  signCanonical,
  verifyCanonical,
} from './encoding.js';
import {
  decodeDeviceRevocationList,
  decodeDeviceRoster,
  decodeSigningKeyRevocation,
  type IDeviceRevocationList,
  type IDeviceRoster,
  type ISigningKeyRevocation,
} from './statements.js';

/** Crockford base32: no I, L, O or U, so a code read aloud or off a screen has one spelling. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_CHARS = 25;
const CODE_GROUP = 5;
const HKDF_SALT = encoder.encode('robota/enroll/v1');
const NONCE_BYTES = 16;
/** A contribution to the short string: committed to or revealed, never chosen after the other one. */
const CONTRIBUTION_BYTES = 32;
const COMMIT_BYTES = 32;
const MAC_BYTES = 32;
const SAS_DIGITS = 1_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Which end of an enrollment this side is. The joiner offers the connection. */
export type TEnrollmentRole = 'joiner' | 'existing';

/** A new enrollment code, as shown to the operator: five groups of five. */
export function generateEnrollmentCode(): string {
  const bytes = randomBytes(CODE_CHARS);
  let code = '';
  for (let i = 0; i < CODE_CHARS; i += 1) {
    if (i > 0 && i % CODE_GROUP === 0) code += '-';
    // 256 is a multiple of 32, so the low five bits are uniform.
    code += CODE_ALPHABET[(bytes[i] as number) & 31];
  }
  return code;
}

/**
 * The canonical form of a typed code, or `undefined` when it is not one. Case, spaces and dashes do
 * not matter, and the letters Crockford reads as digits (O, I, L) are taken as those digits.
 */
export function normalizeEnrollmentCode(text: string): string | undefined {
  const compact = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (compact.length !== CODE_CHARS) return undefined;
  for (const ch of compact) if (!CODE_ALPHABET.includes(ch)) return undefined;
  return compact;
}

/** What both sides derive from the code. Only the topics ever leave the process. */
export interface IEnrollmentMaterial {
  /** The relay topic the existing device waits at. */
  readonly existingInbox: string;
  /** The relay topic the joiner waits at. */
  readonly joinerInbox: string;
  readonly proofKey: CryptoKey;
  readonly sasKey: CryptoKey;
}

async function hkdf(base: CryptoKey, label: string): Promise<Uint8Array> {
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: ab(HKDF_SALT), info: ab(encoder.encode(label)) },
    base,
    256,
  );
  return new Uint8Array(bits);
}

function hmacKey(bytes: Uint8Array): Promise<CryptoKey> {
  return webcrypto.subtle.importKey('raw', ab(bytes), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Derive the topics and keys of an enrollment from its code. Throws when `code` is not a code. */
export async function deriveEnrollmentMaterial(code: string): Promise<IEnrollmentMaterial> {
  const canonical = normalizeEnrollmentCode(code);
  if (canonical === undefined) throw new Error('not an enrollment code');
  const base = await webcrypto.subtle.importKey(
    'raw',
    ab(encoder.encode(canonical)),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const [existingInbox, joinerInbox, proof, sas] = await Promise.all([
    hkdf(base, 'topic/existing'),
    hkdf(base, 'topic/joiner'),
    hkdf(base, 'proof'),
    hkdf(base, 'sas'),
  ]);
  return {
    existingInbox: toBase64Url(existingInbox),
    joinerInbox: toBase64Url(joinerInbox),
    proofKey: await hmacKey(proof),
    sasKey: await hmacKey(sas),
  };
}

// ── Frames ──────────────────────────────────────────────────────────────────────────────────────

export interface IEnrollmentNonceFrame {
  readonly t: 'en-nonce';
  readonly nonce: string;
}

export interface IEnrollmentProofFrame {
  readonly t: 'en-proof';
  readonly mac: string;
}

export type TEnrollmentProofFrame = IEnrollmentNonceFrame | IEnrollmentProofFrame;

/**
 * Joiner → existing: the keys to certify, the name to certify them under, and a commitment to the
 * joiner's contribution to the short string.
 */
export interface IEnrollmentRequestFrame {
  readonly t: 'en-request';
  readonly name: string;
  /** base64url SPKI, ECDSA P-256. */
  readonly signKey: string;
  /** base64url SPKI, X25519. */
  readonly kaKey: string;
  /** See {@link enrollmentCommitment}. */
  readonly commit: string;
  /** By `signKey`, over the binding and the fields above. */
  readonly sig: string;
}

/**
 * Existing → joiner, once the request and its commitment are in: the trust anchor the joiner will pin,
 * and the existing device's contribution to the short string.
 */
export interface IEnrollmentAnchorFrame {
  readonly t: 'en-anchor';
  readonly masterPublicKey: string;
  readonly userId: string;
  readonly contribution: string;
}

/** Joiner → existing, once the anchor is in: the contribution the request committed to. */
export interface IEnrollmentRevealFrame {
  readonly t: 'en-reveal';
  readonly contribution: string;
}

/** Existing → joiner: the chain and lists the joiner keeps. */
export interface IEnrollmentGrantFrame {
  readonly t: 'en-grant';
  readonly signingKeyCert: ISigningKeyCertificate;
  readonly deviceCert: IDeviceCertificate;
  readonly roster: IDeviceRoster;
  readonly revocation: IDeviceRevocationList;
  readonly signingKeyRevocation: ISigningKeyRevocation;
}

export type TEnrollmentFrame =
  | TEnrollmentProofFrame
  | IEnrollmentRequestFrame
  | IEnrollmentAnchorFrame
  | IEnrollmentRevealFrame
  | IEnrollmentGrantFrame
  /** Either side: its operator said no, or it cannot go on. */
  | { readonly t: 'en-declined' }
  /** Joiner → existing: its operator saw the same short string and said yes. */
  | { readonly t: 'en-confirmed' }
  | { readonly t: 'en-stored' };

export type TEnrollmentFrameDecodeResult =
  | { readonly ok: true; readonly frame: TEnrollmentFrame }
  | { readonly ok: false; readonly field: string };

/** Format characters (zero-width, direction overrides): a name with one can read as another. */
const INVISIBLE = /\p{Cf}/u;

function malformed(field: string): TEnrollmentFrameDecodeResult {
  return { ok: false, field };
}

/** The first own key outside `t` and `keys`, or the first of `keys` missing. */
function shapeError(
  r: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  const allowed = new Set(['t', ...keys]);
  for (const key of Object.keys(r)) if (!allowed.has(key)) return 'frame';
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(r, key)) return key;
  return undefined;
}

/** Decode one inbound enrollment frame. Total: never throws; a failure names a field, never a value. */
export function decodeEnrollmentFrame(value: unknown): TEnrollmentFrameDecodeResult {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return malformed('frame');
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return malformed('frame');
    const r = value as Readonly<Record<string, unknown>>;
    const t = Object.prototype.hasOwnProperty.call(r, 't') ? r['t'] : undefined;
    const check = (keys: readonly string[]): string | undefined => shapeError(r, keys);
    switch (t) {
      case 'en-nonce': {
        const bad = check(['nonce']);
        if (bad !== undefined) return malformed(bad);
        if (canonicalBase64Url(r['nonce'], NONCE_BYTES) === undefined) return malformed('nonce');
        return { ok: true, frame: { t, nonce: r['nonce'] as string } };
      }
      case 'en-proof': {
        const bad = check(['mac']);
        if (bad !== undefined) return malformed(bad);
        if (canonicalBase64Url(r['mac'], MAC_BYTES) === undefined) return malformed('mac');
        return { ok: true, frame: { t, mac: r['mac'] as string } };
      }
      case 'en-request': {
        const bad = check(['name', 'signKey', 'kaKey', 'commit', 'sig']);
        if (bad !== undefined) return malformed(bad);
        // The name is shown to the operator deciding; nothing invisible may change how it reads.
        if (!isDeviceName(r['name']) || INVISIBLE.test(r['name'])) return malformed('name');
        if (!isSpki(r['signKey'], 'P256')) return malformed('signKey');
        if (!isSpki(r['kaKey'], 'X25519')) return malformed('kaKey');
        if (canonicalBase64Url(r['commit'], COMMIT_BYTES) === undefined) return malformed('commit');
        if (!isSignature(r['sig'])) return malformed('sig');
        return {
          ok: true,
          frame: {
            t,
            name: r['name'],
            signKey: r['signKey'],
            kaKey: r['kaKey'],
            commit: r['commit'] as string,
            sig: r['sig'],
          },
        };
      }
      case 'en-anchor': {
        const bad = check(['masterPublicKey', 'userId', 'contribution']);
        if (bad !== undefined) return malformed(bad);
        if (!isSpki(r['masterPublicKey'], 'Ed25519')) return malformed('masterPublicKey');
        if (!isId(r['userId'])) return malformed('userId');
        if (canonicalBase64Url(r['contribution'], CONTRIBUTION_BYTES) === undefined) {
          return malformed('contribution');
        }
        return {
          ok: true,
          frame: {
            t,
            masterPublicKey: r['masterPublicKey'],
            userId: r['userId'],
            contribution: r['contribution'] as string,
          },
        };
      }
      case 'en-reveal': {
        const bad = check(['contribution']);
        if (bad !== undefined) return malformed(bad);
        if (canonicalBase64Url(r['contribution'], CONTRIBUTION_BYTES) === undefined) {
          return malformed('contribution');
        }
        return { ok: true, frame: { t, contribution: r['contribution'] as string } };
      }
      case 'en-grant': {
        const bad = check([
          'signingKeyCert',
          'deviceCert',
          'roster',
          'revocation',
          'signingKeyRevocation',
        ]);
        if (bad !== undefined) return malformed(bad);
        const signingKeyCert = decodeSigningKeyCertificate(r['signingKeyCert']);
        if (!signingKeyCert.ok) return malformed('signingKeyCert');
        const deviceCert = decodeDeviceCertificate(r['deviceCert']);
        if (!deviceCert.ok) return malformed('deviceCert');
        const roster = decodeDeviceRoster(r['roster']);
        if (!roster.ok) return malformed('roster');
        const revocation = decodeDeviceRevocationList(r['revocation']);
        if (!revocation.ok) return malformed('revocation');
        const skr = decodeSigningKeyRevocation(r['signingKeyRevocation']);
        if (!skr.ok) return malformed('signingKeyRevocation');
        return {
          ok: true,
          frame: {
            t,
            signingKeyCert: signingKeyCert.value,
            deviceCert: deviceCert.value,
            roster: roster.value,
            revocation: revocation.value,
            signingKeyRevocation: skr.value,
          },
        };
      }
      case 'en-declined':
      case 'en-confirmed':
      case 'en-stored': {
        const bad = check([]);
        if (bad !== undefined) return malformed(bad);
        return { ok: true, frame: { t } };
      }
      default:
        return malformed('t');
    }
  } catch {
    // allow-fallback: a decoder that throws on hostile input (a throwing getter) is a malformed frame
    return malformed('frame');
  }
}

// ── Proof ───────────────────────────────────────────────────────────────────────────────────────

export type TEnrollmentRefusal =
  'malformed-frame' | 'unexpected-frame' | 'proof-failed' | 'timeout' | 'internal';

export class EnrollmentError extends Error {
  readonly reason: TEnrollmentRefusal;
  /** For `malformed-frame`: which field failed. Never its value. */
  readonly field?: string;

  constructor(reason: TEnrollmentRefusal, field?: string) {
    super(`enrollment refused: ${reason}${field !== undefined ? ` (${field})` : ''}`);
    this.name = 'EnrollmentError';
    this.reason = reason;
    if (field !== undefined) this.field = field;
  }
}

/** What both sides proved the code over: the negotiated channel and this run's nonces. */
export interface IEnrollmentBinding {
  readonly fingerprintJoiner: string;
  readonly fingerprintExisting: string;
  readonly nonceJoiner: string;
  readonly nonceExisting: string;
}

function bindingFields(binding: IEnrollmentBinding): string[] {
  return [
    binding.fingerprintJoiner,
    binding.fingerprintExisting,
    binding.nonceJoiner,
    binding.nonceExisting,
  ];
}

function proofBytes(sender: TEnrollmentRole, binding: IEnrollmentBinding): Uint8Array {
  return canonicalBytes(IDENTITY_PURPOSES.enrollProof, [sender, ...bindingFields(binding)]);
}

export interface IEnrollmentProofOptions {
  readonly role: TEnrollmentRole;
  readonly material: IEnrollmentMaterial;
  /** This side's DTLS fingerprint. */
  readonly localFingerprint: string;
  /** The fingerprint of the certificate the DTLS layer verified — never SDP text. */
  readonly remoteFingerprint: string;
  readonly send: (frame: TEnrollmentProofFrame) => void;
  /** Default 10 s. */
  readonly timeoutMs?: number;
}

export interface IEnrollmentProofController {
  /** Resolves only once the peer proved the code over this channel. The caller closes it otherwise. */
  readonly result: Promise<IEnrollmentBinding>;
  /** Feed one inbound frame exactly as received. Never throws. */
  onFrame(frame: unknown): void;
}

/** Start one side of the proof. Sends this side's nonce at once. */
export function startEnrollmentProof(options: IEnrollmentProofOptions): IEnrollmentProofController {
  const peerRole: TEnrollmentRole = options.role === 'joiner' ? 'existing' : 'joiner';
  const localNonce = toBase64Url(randomBytes(NONCE_BYTES));
  let expecting: 'en-nonce' | 'en-proof' | 'done' = 'en-nonce';
  let binding: IEnrollmentBinding | undefined;
  let chain: Promise<void> = Promise.resolve();
  let settled = false;
  let resolve!: (value: IEnrollmentBinding) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<IEnrollmentBinding>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(
    () => fail(new EnrollmentError('timeout')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  function fail(error: unknown): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(error instanceof EnrollmentError ? error : new EnrollmentError('internal'));
  }

  function fingerprints(): Pick<IEnrollmentBinding, 'fingerprintJoiner' | 'fingerprintExisting'> {
    return options.role === 'joiner'
      ? {
          fingerprintJoiner: options.localFingerprint,
          fingerprintExisting: options.remoteFingerprint,
        }
      : {
          fingerprintJoiner: options.remoteFingerprint,
          fingerprintExisting: options.localFingerprint,
        };
  }

  async function step(frame: TEnrollmentFrame): Promise<void> {
    if (settled) return;
    if (frame.t !== expecting) throw new EnrollmentError('unexpected-frame');
    if (frame.t === 'en-nonce') {
      binding = {
        ...fingerprints(),
        nonceJoiner: options.role === 'joiner' ? localNonce : frame.nonce,
        nonceExisting: options.role === 'joiner' ? frame.nonce : localNonce,
      };
      const mac = new Uint8Array(
        await webcrypto.subtle.sign(
          'HMAC',
          options.material.proofKey,
          ab(proofBytes(options.role, binding)),
        ),
      );
      if (settled) return;
      expecting = 'en-proof';
      options.send({ t: 'en-proof', mac: toBase64Url(mac) });
      return;
    }
    if (frame.t !== 'en-proof' || binding === undefined)
      throw new EnrollmentError('unexpected-frame');
    expecting = 'done';
    const ok = await webcrypto.subtle.verify(
      'HMAC',
      options.material.proofKey,
      ab(decodeBase64Url(frame.mac)),
      ab(proofBytes(peerRole, binding)),
    );
    if (!ok) throw new EnrollmentError('proof-failed');
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(binding);
  }

  options.send({ t: 'en-nonce', nonce: localNonce });

  return {
    result,
    onFrame(frame: unknown): void {
      if (settled) return;
      const decoded = decodeEnrollmentFrame(frame);
      if (!decoded.ok) {
        fail(new EnrollmentError('malformed-frame', decoded.field));
        return;
      }
      // One frame at a time, in arrival order: a proof may arrive while the nonce is still being used.
      chain = chain.then(() => step(decoded.frame)).catch(fail);
    },
  };
}

// ── Request ─────────────────────────────────────────────────────────────────────────────────────

export interface IEnrollmentRequestFields {
  readonly name: string;
  readonly signKey: string;
  readonly kaKey: string;
}

function requestBytes(
  binding: IEnrollmentBinding,
  fields: IEnrollmentRequestFields & { readonly commit: string },
): Uint8Array {
  return canonicalBytes(IDENTITY_PURPOSES.enrollRequest, [
    ...bindingFields(binding),
    fields.name,
    fields.signKey,
    fields.kaKey,
    fields.commit,
  ]);
}

/** A fresh contribution to the short string. */
export function newEnrollmentContribution(): string {
  return toBase64Url(randomBytes(CONTRIBUTION_BYTES));
}

/**
 * The joiner's commitment to its contribution, bound to this channel. It is sent with the request,
 * before the existing device reveals its own contribution, and opened only after: so neither side,
 * nor anyone between them who knows the code, can choose its part after seeing the other's.
 */
export async function enrollmentCommitment(
  binding: IEnrollmentBinding,
  contribution: string,
): Promise<string> {
  const bytes = canonicalBytes(IDENTITY_PURPOSES.enrollCommit, [
    ...bindingFields(binding),
    contribution,
  ]);
  return toBase64Url(new Uint8Array(await webcrypto.subtle.digest('SHA-256', ab(bytes))));
}

/** Whether `contribution` opens `commit` on this channel. */
export async function verifyEnrollmentReveal(
  binding: IEnrollmentBinding,
  commit: string,
  contribution: string,
): Promise<boolean> {
  return (await enrollmentCommitment(binding, contribution)) === commit;
}

/** The joiner's request, signed with its new device key over the proven binding. */
export async function signEnrollmentRequest(
  options: IEnrollmentRequestFields & {
    readonly binding: IEnrollmentBinding;
    readonly signPrivateKey: CryptoKey;
    readonly commit: string;
  },
): Promise<IEnrollmentRequestFrame> {
  const fields = {
    name: options.name,
    signKey: options.signKey,
    kaKey: options.kaKey,
    commit: options.commit,
  };
  const sig = await signCanonical(options.signPrivateKey, requestBytes(options.binding, fields));
  return { t: 'en-request', ...fields, sig };
}

/** Whether `request` was signed by the key it names, over this binding. */
export async function verifyEnrollmentRequest(
  binding: IEnrollmentBinding,
  request: IEnrollmentRequestFrame,
): Promise<boolean> {
  const key = await importVerifyKey('ES256', request.signKey);
  if (key === undefined) return false;
  return verifyCanonical(key, request.sig, requestBytes(binding, request));
}

// ── Short authentication string ─────────────────────────────────────────────────────────────────

/**
 * Six digits both operators compare: `123 456`. They cover the channel, the request, the anchor and
 * both contributions, so a party in the middle that knows the code gets matching digits on the two
 * screens only by a one-in-a-million chance per attempt.
 */
export async function enrollmentSas(options: {
  readonly material: IEnrollmentMaterial;
  readonly binding: IEnrollmentBinding;
  readonly request: IEnrollmentRequestFields;
  readonly anchor: { readonly masterPublicKey: string; readonly userId: string };
  readonly contributions: { readonly joiner: string; readonly existing: string };
}): Promise<string> {
  const bytes = canonicalBytes(IDENTITY_PURPOSES.enrollSas, [
    ...bindingFields(options.binding),
    options.request.name,
    options.request.signKey,
    options.request.kaKey,
    options.anchor.masterPublicKey,
    options.anchor.userId,
    options.contributions.joiner,
    options.contributions.existing,
  ]);
  const mac = new Uint8Array(
    await webcrypto.subtle.sign('HMAC', options.material.sasKey, ab(bytes)),
  );
  const value = new DataView(mac.buffer).getUint32(0) % SAS_DIGITS;
  const digits = value.toString().padStart(6, '0');
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
