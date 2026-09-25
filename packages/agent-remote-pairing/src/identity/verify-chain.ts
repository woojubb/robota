/**
 * Verification of the identity chain: master → signing key → device, against the optional roster
 * and revocation lists, at one moment.
 *
 * Every input arrives as `unknown` because it arrived from a peer. Each is decoded (shape, lengths,
 * purpose) before any crypto, its signature is checked before any of its fields is trusted, and
 * every refusal is a closed reason naming the structure that failed — never a throw, never the
 * value. Anything not positively established is a refusal.
 */

import {
  IDENTITY_CLOCK_SKEW_MS,
  decodeBase64Url,
  importVerifyKey,
  isSpki,
  keyIdOfSpki,
  verifyCanonical,
  type IDecodeFailure,
} from './encoding.js';
import {
  decodeDeviceCertificate,
  decodeSigningKeyCertificate,
  deviceCertificateBytes,
  signingKeyCertificateBytes,
  type IDeviceCertificate,
  type TDeviceCapability,
} from './certificates.js';
import {
  decodeDeviceRevocationList,
  decodeDeviceRoster,
  decodeSessionDescriptor,
  decodeSigningKeyRevocation,
  revocationListBytes,
  rosterBytes,
  sameDeviceCertificate,
  sessionDescriptorBytes,
  signingKeyRevocationBytes,
} from './statements.js';

export type TChainSubject =
  | 'signing-key-cert'
  | 'device-cert'
  | 'roster'
  | 'revocation'
  | 'signing-key-revocation'
  | 'session-desc';

/** Why a chain was refused. Closed, so a caller cannot read a softer outcome into it. */
export type TChainRejection =
  | 'malformed'
  | 'wrong-purpose'
  | 'signature-invalid'
  | 'user-mismatch'
  | 'signing-key-mismatch'
  | 'key-id-mismatch'
  | 'expired'
  | 'not-yet-valid'
  | 'revoked'
  | 'signing-key-revoked'
  | 'not-in-roster'
  | 'stale'
  | 'rolled-back';

export interface IChainRejection<TReason extends string = TChainRejection> {
  readonly ok: false;
  readonly reason: TReason;
  readonly subject: TChainSubject;
}

/** The highest `seq` this verifier has already accepted for each list. */
export interface IListHighWaterMarks {
  readonly rosterSeq?: number;
  readonly revocationSeq?: number;
  readonly signingKeyRevocationSeq?: number;
}

export interface IVerifyDeviceChainInput {
  /** base64url SPKI of the user's Ed25519 master public key — the pinned trust anchor. */
  readonly masterPublicKey: string;
  readonly signingKeyCert: unknown;
  readonly deviceCert: unknown;
  readonly roster?: unknown;
  readonly revocation?: unknown;
  readonly signingKeyRevocation?: unknown;
  readonly now: number;
  /**
   * Supplied by the caller, who persists them. Absent means "none seen yet", which is right on a
   * fresh device; a caller that drops its marks is choosing to accept a rollback.
   */
  readonly lastSeen?: IListHighWaterMarks;
}

export type TDeviceChainVerdict =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly signingKeyId: string;
      readonly deviceId: string;
      readonly capabilities: readonly TDeviceCapability[];
      /** The decoded, verified certificate — use this, not the input object. */
      readonly deviceCertificate: IDeviceCertificate;
      /** The `seq` of each list accepted here, for the caller to record as its new marks. */
      readonly accepted: IListHighWaterMarks;
    }
  | IChainRejection;

function reject<TReason extends string>(
  reason: TReason,
  subject: TChainSubject,
): IChainRejection<TReason> {
  return { ok: false, reason, subject };
}

function fromDecode(failure: IDecodeFailure, subject: TChainSubject): IChainRejection {
  return reject(failure.reason, subject);
}

/** Validity with the documented skew on both ends. */
function windowCheck(
  now: number,
  notBefore: number,
  notAfter: number | undefined,
  expiredReason: 'expired' | 'stale',
): 'not-yet-valid' | 'expired' | 'stale' | undefined {
  if (now + IDENTITY_CLOCK_SKEW_MS < notBefore) return 'not-yet-valid';
  if (notAfter !== undefined && now - IDENTITY_CLOCK_SKEW_MS >= notAfter) return expiredReason;
  return undefined;
}

function rolledBack(seq: number, mark: number | undefined): boolean {
  return mark !== undefined && seq < mark;
}

/** Verify that `deviceCert` belongs to the user anchored by `masterPublicKey`, right now. */
export async function verifyDeviceChain(
  input: IVerifyDeviceChainInput,
): Promise<TDeviceChainVerdict> {
  let subject: TChainSubject = 'signing-key-cert';
  try {
    const lastSeen = input.lastSeen ?? {};
    const accepted: { rosterSeq?: number; revocationSeq?: number; signingKeyRevocationSeq?: number } =
      {};

    // ── Trust anchor ───────────────────────────────────────────────────────────────────────────
    if (!isSpki(input.masterPublicKey, 'Ed25519')) return reject('signature-invalid', subject);
    const masterKey = await importVerifyKey('Ed25519', input.masterPublicKey);
    if (masterKey === undefined) return reject('signature-invalid', subject);
    const userId = await keyIdOfSpki(decodeBase64Url(input.masterPublicKey));

    // ── Signing-key certificate (master-signed) ────────────────────────────────────────────────
    const skc = decodeSigningKeyCertificate(input.signingKeyCert);
    if (!skc.ok) return fromDecode(skc, subject);
    const signingCert = skc.value;
    if (!(await verifyCanonical(masterKey, signingCert.sig, signingKeyCertificateBytes(signingCert)))) {
      return reject('signature-invalid', subject);
    }
    if (signingCert.userId !== userId) return reject('user-mismatch', subject);
    if ((await keyIdOfSpki(decodeBase64Url(signingCert.publicKey))) !== signingCert.signingKeyId) {
      return reject('key-id-mismatch', subject);
    }
    const signingWindow = windowCheck(input.now, signingCert.issuedAt, signingCert.expiresAt, 'expired');
    if (signingWindow !== undefined) return reject(signingWindow, subject);
    const signingKey = await importVerifyKey(signingCert.alg, signingCert.publicKey);
    if (signingKey === undefined) return reject('signature-invalid', subject);

    // ── Signing-key revocation (master-signed) ─────────────────────────────────────────────────
    if (input.signingKeyRevocation !== undefined) {
      subject = 'signing-key-revocation';
      const decoded = decodeSigningKeyRevocation(input.signingKeyRevocation);
      if (!decoded.ok) return fromDecode(decoded, subject);
      const list = decoded.value;
      if (!(await verifyCanonical(masterKey, list.sig, signingKeyRevocationBytes(list)))) {
        return reject('signature-invalid', subject);
      }
      if (list.userId !== userId) return reject('user-mismatch', subject);
      const window = windowCheck(input.now, list.issuedAt, undefined, 'stale');
      if (window !== undefined) return reject(window, subject);
      if (rolledBack(list.seq, lastSeen.signingKeyRevocationSeq)) return reject('rolled-back', subject);
      if (list.revokedSigningKeyIds.includes(signingCert.signingKeyId)) {
        return reject('signing-key-revoked', subject);
      }
      accepted.signingKeyRevocationSeq = list.seq;
    }

    // ── Device certificate (signing-key-signed) ────────────────────────────────────────────────
    subject = 'device-cert';
    const dc = decodeDeviceCertificate(input.deviceCert);
    if (!dc.ok) return fromDecode(dc, subject);
    const device = dc.value;
    if (device.signingKeyId !== signingCert.signingKeyId) {
      return reject('signing-key-mismatch', subject);
    }
    if (!(await verifyCanonical(signingKey, device.sig, deviceCertificateBytes(device)))) {
      return reject('signature-invalid', subject);
    }
    if (device.userId !== userId) return reject('user-mismatch', subject);
    if ((await keyIdOfSpki(decodeBase64Url(device.signKey))) !== device.deviceId) {
      return reject('key-id-mismatch', subject);
    }
    const deviceWindow = windowCheck(input.now, device.issuedAt, device.expiresAt, 'expired');
    if (deviceWindow !== undefined) return reject(deviceWindow, subject);

    // ── Device revocation list (signing-key-signed) ────────────────────────────────────────────
    if (input.revocation !== undefined) {
      subject = 'revocation';
      const decoded = decodeDeviceRevocationList(input.revocation);
      if (!decoded.ok) return fromDecode(decoded, subject);
      const list = decoded.value;
      if (list.signingKeyId !== signingCert.signingKeyId) {
        return reject('signing-key-mismatch', subject);
      }
      if (!(await verifyCanonical(signingKey, list.sig, revocationListBytes(list)))) {
        return reject('signature-invalid', subject);
      }
      if (list.userId !== userId) return reject('user-mismatch', subject);
      const window = windowCheck(input.now, list.issuedAt, list.expiresAt, 'stale');
      if (window !== undefined) return reject(window, subject);
      if (rolledBack(list.seq, lastSeen.revocationSeq)) return reject('rolled-back', subject);
      if (list.revokedDeviceIds.includes(device.deviceId)) return reject('revoked', subject);
      accepted.revocationSeq = list.seq;
    }

    // ── Roster (signing-key-signed) ────────────────────────────────────────────────────────────
    if (input.roster !== undefined) {
      subject = 'roster';
      const decoded = decodeDeviceRoster(input.roster);
      if (!decoded.ok) return fromDecode(decoded, subject);
      const roster = decoded.value;
      if (roster.signingKeyId !== signingCert.signingKeyId) {
        return reject('signing-key-mismatch', subject);
      }
      if (!(await verifyCanonical(signingKey, roster.sig, rosterBytes(roster)))) {
        return reject('signature-invalid', subject);
      }
      if (roster.userId !== userId) return reject('user-mismatch', subject);
      const window = windowCheck(input.now, roster.issuedAt, roster.expiresAt, 'stale');
      if (window !== undefined) return reject(window, subject);
      if (rolledBack(roster.seq, lastSeen.rosterSeq)) return reject('rolled-back', subject);
      if (!roster.devices.some((entry) => sameDeviceCertificate(entry, device))) {
        return reject('not-in-roster', subject);
      }
      accepted.rosterSeq = roster.seq;
    }

    return {
      ok: true,
      userId,
      signingKeyId: signingCert.signingKeyId,
      deviceId: device.deviceId,
      capabilities: device.capabilities,
      deviceCertificate: device,
      accepted,
    };
  } catch {
    // allow-fallback: an unexpected failure anywhere in verification is a refusal, never a pass
    return reject('malformed', subject);
  }
}

// ── Session descriptor ──────────────────────────────────────────────────────────────────────────

export type TSessionRejection =
  | 'malformed'
  | 'wrong-purpose'
  | 'signature-invalid'
  | 'device-mismatch'
  | 'expired'
  | 'not-yet-valid';

export interface IVerifySessionDescriptorOptions {
  /** A device certificate already accepted by `verifyDeviceChain`. */
  readonly deviceCertificate: IDeviceCertificate;
  readonly now: number;
}

export type TSessionDescriptorVerdict =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly deviceId: string;
      readonly workspaceClaim?: string;
    }
  | IChainRejection<TSessionRejection>;

/** Verify a session descriptor signed by the certified device's `signKey`. */
export async function verifySessionDescriptor(
  value: unknown,
  options: IVerifySessionDescriptorOptions,
): Promise<TSessionDescriptorVerdict> {
  const subject = 'session-desc';
  try {
    const decoded = decodeSessionDescriptor(value);
    if (!decoded.ok) return reject(decoded.reason, subject);
    const desc = decoded.value;
    if (desc.deviceId !== options.deviceCertificate.deviceId) return reject('device-mismatch', subject);
    const signKey = await importVerifyKey('ES256', options.deviceCertificate.signKey);
    if (signKey === undefined) return reject('signature-invalid', subject);
    if (!(await verifyCanonical(signKey, desc.sig, sessionDescriptorBytes(desc)))) {
      return reject('signature-invalid', subject);
    }
    const window = windowCheck(options.now, desc.startedAt, desc.expiresAt, 'expired');
    if (window === 'not-yet-valid' || window === 'expired') return reject(window, subject);
    return {
      ok: true,
      sessionId: desc.sessionId,
      deviceId: desc.deviceId,
      ...(desc.workspaceClaim !== undefined ? { workspaceClaim: desc.workspaceClaim } : {}),
    };
  } catch {
    // allow-fallback: an unexpected failure is a refusal, never a pass
    return reject('malformed', subject);
  }
}
