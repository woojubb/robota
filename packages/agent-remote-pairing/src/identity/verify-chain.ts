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

/** The highest `seq` accepted for one signing key's device lists. */
export interface IDeviceListMarks {
  readonly rosterSeq?: number;
  readonly revocationSeq?: number;
}

/**
 * The highest `seq` this verifier has already accepted for each list. Roster and revocation marks
 * are kept per signing key, because each of those lists speaks only for the key that issued it: a
 * second or rotated signing key numbers its own lists.
 */
export interface IListHighWaterMarks {
  readonly signingKeyRevocationSeq?: number;
  /** Keyed by `signingKeyId`. */
  readonly bySigningKey?: Readonly<Record<string, IDeviceListMarks>>;
}

/** Lists the caller insists on even when it holds no mark for them yet. */
export interface IRequiredLists {
  readonly roster?: boolean;
  readonly revocation?: boolean;
  readonly signingKeyRevocation?: boolean;
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
  /**
   * A list left out is refused as `stale` when it is required here or when `lastSeen` holds a mark
   * for it: an omitted list is the oldest list there is, and a peer must not be able to skip the
   * one that names it.
   */
  readonly required?: IRequiredLists;
  /**
   * How long past its expiry a roster or revocation list is still accepted. Absent means none. A
   * list inside the window is reported through `listsExpiredAt` so the caller can warn; a list past
   * it is `stale`. How long to tolerate is the caller's policy, not this verifier's.
   */
  readonly listExpiryGraceMs?: number;
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
      /**
       * The `seq` of each list accepted here, for the caller to record as its new marks (the
       * roster and revocation marks under `signingKeyId`).
       */
      readonly accepted: IDeviceListMarks & { readonly signingKeyRevocationSeq?: number };
      /** The earliest expiry among accepted roster and revocation lists that has passed. */
      readonly listsExpiredAt?: number;
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

/**
 * A device list's window: as for any statement, except that an expiry less than `graceMs` ago is
 * accepted and reported rather than refused.
 */
function listWindowCheck(
  now: number,
  list: { readonly issuedAt: number; readonly expiresAt: number },
  graceMs: number,
): 'not-yet-valid' | 'stale' | 'grace' | undefined {
  if (now + IDENTITY_CLOCK_SKEW_MS < list.issuedAt) return 'not-yet-valid';
  if (now - IDENTITY_CLOCK_SKEW_MS < list.expiresAt) return undefined;
  return now - IDENTITY_CLOCK_SKEW_MS < list.expiresAt + graceMs ? 'grace' : 'stale';
}

function rolledBack(seq: number, mark: number | undefined): boolean {
  return mark !== undefined && seq < mark;
}

/** This signing key's marks. Own properties only, so an inherited name is never a mark. */
function marksFor(lastSeen: IListHighWaterMarks, signingKeyId: string): IDeviceListMarks {
  const table = lastSeen.bySigningKey;
  if (table === undefined || !Object.prototype.hasOwnProperty.call(table, signingKeyId)) return {};
  return table[signingKeyId] ?? {};
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
    const graceMs = Math.max(0, input.listExpiryGraceMs ?? 0);
    let listsExpiredAt: number | undefined;
    const noteExpired = (expiresAt: number): void => {
      listsExpiredAt = Math.min(listsExpiredAt ?? expiresAt, expiresAt);
    };

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
    const required = input.required ?? {};
    const deviceMarks = marksFor(lastSeen, signingCert.signingKeyId);

    // ── Signing-key revocation (master-signed) ─────────────────────────────────────────────────
    subject = 'signing-key-revocation';
    if (input.signingKeyRevocation === undefined) {
      if (required.signingKeyRevocation === true || lastSeen.signingKeyRevocationSeq !== undefined) {
        return reject('stale', subject);
      }
    } else {
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
    subject = 'revocation';
    if (input.revocation === undefined) {
      if (required.revocation === true || deviceMarks.revocationSeq !== undefined) {
        return reject('stale', subject);
      }
    } else {
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
      const window = listWindowCheck(input.now, list, graceMs);
      if (window === 'grace') noteExpired(list.expiresAt);
      else if (window !== undefined) return reject(window, subject);
      if (rolledBack(list.seq, deviceMarks.revocationSeq)) return reject('rolled-back', subject);
      if (list.revokedDeviceIds.includes(device.deviceId)) return reject('revoked', subject);
      accepted.revocationSeq = list.seq;
    }

    // ── Roster (signing-key-signed) ────────────────────────────────────────────────────────────
    subject = 'roster';
    if (input.roster === undefined) {
      if (required.roster === true || deviceMarks.rosterSeq !== undefined) {
        return reject('stale', subject);
      }
    } else {
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
      const window = listWindowCheck(input.now, roster, graceMs);
      if (window === 'grace') noteExpired(roster.expiresAt);
      else if (window !== undefined) return reject(window, subject);
      if (rolledBack(roster.seq, deviceMarks.rosterSeq)) return reject('rolled-back', subject);
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
      ...(listsExpiredAt !== undefined ? { listsExpiredAt } : {}),
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
