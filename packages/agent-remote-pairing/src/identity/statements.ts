/**
 * The signed statements around device certificates: the roster, the two revocation lists, and the
 * session descriptor a device signs for itself.
 *
 * Roster and lists carry a monotonic `seq`; a reader refuses one below the last it saw, so a
 * captured older list cannot roll a verifier back to before a revocation. The device lists also
 * expire, because a withheld list and a stale one look the same to the reader.
 */

import {
  DAY_MS,
  IDENTITY_PURPOSES,
  canonicalBytes,
  isCount,
  isId,
  isSignature,
  isSortedIdSet,
  malformed,
  openStatement,
  signCanonical,
  sortedUnique,
  type TCanonical,
  type TDecoded,
} from './encoding.js';
import {
  decodeDeviceCertificate,
  deviceCertificateFields,
  type IDeviceCertificate,
  type ISigningKey,
} from './certificates.js';

/** Default lifetime of a device revocation list; it is reissued before this passes. */
export const REVOCATION_LIST_VALIDITY_MS = DAY_MS;
/** Default lifetime of a roster; removal from the roster is a revocation, so it ages the same way. */
export const ROSTER_VALIDITY_MS = DAY_MS;
/** Default lifetime of a session descriptor. */
export const SESSION_DESCRIPTOR_VALIDITY_MS = DAY_MS;

/** Bounds a decoder enforces before any crypto, so an oversized statement costs nothing. */
export const IDENTITY_STATEMENT_LIMITS = {
  rosterDevices: 64,
  revokedDeviceIds: 1024,
  revokedSigningKeyIds: 64,
  sessionIdChars: 64,
  workspaceClaimChars: 128,
} as const;

// ── Roster ──────────────────────────────────────────────────────────────────────────────────────

export interface IDeviceRoster {
  readonly ctx: typeof IDENTITY_PURPOSES.roster;
  readonly userId: string;
  readonly signingKeyId: string;
  readonly seq: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** Strictly ascending by `deviceId`. */
  readonly devices: readonly IDeviceCertificate[];
  readonly sig: string;
}

function rosterEntry(device: IDeviceCertificate): TCanonical {
  return [device.ctx, ...deviceCertificateFields(device), device.sig];
}

export function rosterBytes(roster: Omit<IDeviceRoster, 'sig' | 'ctx'>): Uint8Array {
  return canonicalBytes(IDENTITY_PURPOSES.roster, [
    roster.userId,
    roster.signingKeyId,
    roster.seq,
    roster.issuedAt,
    roster.expiresAt,
    roster.devices.map(rosterEntry),
  ]);
}

/** Whether two device certificates are the same signed statement. */
export function sameDeviceCertificate(a: IDeviceCertificate, b: IDeviceCertificate): boolean {
  return JSON.stringify(rosterEntry(a)) === JSON.stringify(rosterEntry(b));
}

const ROSTER_FIELDS = [
  'userId',
  'signingKeyId',
  'seq',
  'issuedAt',
  'expiresAt',
  'devices',
  'sig',
] as const;

export function decodeDeviceRoster(value: unknown): TDecoded<IDeviceRoster> {
  const opened = openStatement(value, IDENTITY_PURPOSES.roster, ROSTER_FIELDS);
  if (!opened.ok) return opened;
  const r = opened.value;
  if (!isId(r['userId'])) return malformed('userId');
  if (!isId(r['signingKeyId'])) return malformed('signingKeyId');
  if (!isCount(r['seq'])) return malformed('seq');
  if (!isCount(r['issuedAt'])) return malformed('issuedAt');
  if (!isCount(r['expiresAt']) || r['expiresAt'] <= r['issuedAt']) return malformed('expiresAt');
  const rawDevices = r['devices'];
  if (!Array.isArray(rawDevices) || rawDevices.length > IDENTITY_STATEMENT_LIMITS.rosterDevices) {
    return malformed('devices');
  }
  const devices: IDeviceCertificate[] = [];
  for (const raw of rawDevices) {
    const decoded = decodeDeviceCertificate(raw);
    if (!decoded.ok) return malformed('devices');
    const previous = devices[devices.length - 1];
    if (previous !== undefined && !(previous.deviceId < decoded.value.deviceId)) {
      return malformed('devices');
    }
    devices.push(decoded.value);
  }
  if (!isSignature(r['sig'])) return malformed('sig');
  return {
    ok: true,
    value: {
      ctx: IDENTITY_PURPOSES.roster,
      userId: r['userId'],
      signingKeyId: r['signingKeyId'],
      seq: r['seq'],
      issuedAt: r['issuedAt'],
      expiresAt: r['expiresAt'],
      devices,
      sig: r['sig'],
    },
  };
}

export interface IIssueRosterOptions {
  readonly signingKey: ISigningKey;
  readonly seq: number;
  readonly issuedAt: number;
  /** Defaults to `issuedAt + ROSTER_VALIDITY_MS`. */
  readonly expiresAt?: number;
  readonly devices: readonly IDeviceCertificate[];
}

export async function issueDeviceRoster(options: IIssueRosterOptions): Promise<IDeviceRoster> {
  const byId = new Map<string, IDeviceCertificate>();
  for (const device of options.devices) {
    if (byId.has(device.deviceId)) throw new Error('roster: a device may appear only once');
    byId.set(device.deviceId, device);
  }
  const issuer = options.signingKey.certificate;
  const unsigned = {
    userId: issuer.userId,
    signingKeyId: issuer.signingKeyId,
    seq: options.seq,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt ?? options.issuedAt + ROSTER_VALIDITY_MS,
    devices: [...byId.keys()].sort().map((id) => byId.get(id) as IDeviceCertificate),
  };
  const sig = await signCanonical(options.signingKey.privateKey, rosterBytes(unsigned));
  return { ctx: IDENTITY_PURPOSES.roster, ...unsigned, sig };
}

// ── Device revocation list ──────────────────────────────────────────────────────────────────────

export interface IDeviceRevocationList {
  readonly ctx: typeof IDENTITY_PURPOSES.revocation;
  readonly userId: string;
  readonly signingKeyId: string;
  readonly seq: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** Strictly ascending. An empty list is a real statement: nothing is revoked as of `issuedAt`. */
  readonly revokedDeviceIds: readonly string[];
  readonly sig: string;
}

export function revocationListBytes(list: Omit<IDeviceRevocationList, 'sig' | 'ctx'>): Uint8Array {
  return canonicalBytes(IDENTITY_PURPOSES.revocation, [
    list.userId,
    list.signingKeyId,
    list.seq,
    list.issuedAt,
    list.expiresAt,
    list.revokedDeviceIds,
  ]);
}

const REVOCATION_FIELDS = [
  'userId',
  'signingKeyId',
  'seq',
  'issuedAt',
  'expiresAt',
  'revokedDeviceIds',
  'sig',
] as const;

export function decodeDeviceRevocationList(value: unknown): TDecoded<IDeviceRevocationList> {
  const opened = openStatement(value, IDENTITY_PURPOSES.revocation, REVOCATION_FIELDS);
  if (!opened.ok) return opened;
  const r = opened.value;
  if (!isId(r['userId'])) return malformed('userId');
  if (!isId(r['signingKeyId'])) return malformed('signingKeyId');
  if (!isCount(r['seq'])) return malformed('seq');
  if (!isCount(r['issuedAt'])) return malformed('issuedAt');
  if (!isCount(r['expiresAt']) || r['expiresAt'] <= r['issuedAt']) return malformed('expiresAt');
  if (!isSortedIdSet(r['revokedDeviceIds'], IDENTITY_STATEMENT_LIMITS.revokedDeviceIds)) {
    return malformed('revokedDeviceIds');
  }
  if (!isSignature(r['sig'])) return malformed('sig');
  return {
    ok: true,
    value: {
      ctx: IDENTITY_PURPOSES.revocation,
      userId: r['userId'],
      signingKeyId: r['signingKeyId'],
      seq: r['seq'],
      issuedAt: r['issuedAt'],
      expiresAt: r['expiresAt'],
      revokedDeviceIds: [...r['revokedDeviceIds']],
      sig: r['sig'],
    },
  };
}

export interface IIssueRevocationListOptions {
  readonly signingKey: ISigningKey;
  readonly seq: number;
  readonly issuedAt: number;
  /** Defaults to `issuedAt + REVOCATION_LIST_VALIDITY_MS`. */
  readonly expiresAt?: number;
  readonly revokedDeviceIds: readonly string[];
}

export async function issueDeviceRevocationList(
  options: IIssueRevocationListOptions,
): Promise<IDeviceRevocationList> {
  const issuer = options.signingKey.certificate;
  const unsigned = {
    userId: issuer.userId,
    signingKeyId: issuer.signingKeyId,
    seq: options.seq,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt ?? options.issuedAt + REVOCATION_LIST_VALIDITY_MS,
    revokedDeviceIds: sortedUnique(options.revokedDeviceIds),
  };
  const sig = await signCanonical(options.signingKey.privateKey, revocationListBytes(unsigned));
  return { ctx: IDENTITY_PURPOSES.revocation, ...unsigned, sig };
}

// ── Signing-key revocation ──────────────────────────────────────────────────────────────────────

/**
 * Master-signed retirement of signing keys. It has no expiry: it is issued rarely, by the one key
 * that is never online, and a signing key once retired never comes back.
 */
export interface ISigningKeyRevocation {
  readonly ctx: typeof IDENTITY_PURPOSES.signingKeyRevocation;
  readonly userId: string;
  readonly seq: number;
  readonly issuedAt: number;
  /** Strictly ascending. */
  readonly revokedSigningKeyIds: readonly string[];
  readonly sig: string;
}

export function signingKeyRevocationBytes(
  list: Omit<ISigningKeyRevocation, 'sig' | 'ctx'>,
): Uint8Array {
  return canonicalBytes(IDENTITY_PURPOSES.signingKeyRevocation, [
    list.userId,
    list.seq,
    list.issuedAt,
    list.revokedSigningKeyIds,
  ]);
}

const SIGNING_KEY_REVOCATION_FIELDS = [
  'userId',
  'seq',
  'issuedAt',
  'revokedSigningKeyIds',
  'sig',
] as const;

export function decodeSigningKeyRevocation(value: unknown): TDecoded<ISigningKeyRevocation> {
  const opened = openStatement(
    value,
    IDENTITY_PURPOSES.signingKeyRevocation,
    SIGNING_KEY_REVOCATION_FIELDS,
  );
  if (!opened.ok) return opened;
  const r = opened.value;
  if (!isId(r['userId'])) return malformed('userId');
  if (!isCount(r['seq'])) return malformed('seq');
  if (!isCount(r['issuedAt'])) return malformed('issuedAt');
  if (!isSortedIdSet(r['revokedSigningKeyIds'], IDENTITY_STATEMENT_LIMITS.revokedSigningKeyIds)) {
    return malformed('revokedSigningKeyIds');
  }
  if (!isSignature(r['sig'])) return malformed('sig');
  return {
    ok: true,
    value: {
      ctx: IDENTITY_PURPOSES.signingKeyRevocation,
      userId: r['userId'],
      seq: r['seq'],
      issuedAt: r['issuedAt'],
      revokedSigningKeyIds: [...r['revokedSigningKeyIds']],
      sig: r['sig'],
    },
  };
}

export interface IIssueSigningKeyRevocationOptions {
  readonly masterPrivateKey: CryptoKey;
  readonly userId: string;
  readonly seq: number;
  readonly issuedAt: number;
  readonly revokedSigningKeyIds: readonly string[];
}

export async function issueSigningKeyRevocation(
  options: IIssueSigningKeyRevocationOptions,
): Promise<ISigningKeyRevocation> {
  const unsigned = {
    userId: options.userId,
    seq: options.seq,
    issuedAt: options.issuedAt,
    revokedSigningKeyIds: sortedUnique(options.revokedSigningKeyIds),
  };
  const sig = await signCanonical(options.masterPrivateKey, signingKeyRevocationBytes(unsigned));
  return { ctx: IDENTITY_PURPOSES.signingKeyRevocation, ...unsigned, sig };
}

// ── Session descriptor ──────────────────────────────────────────────────────────────────────────

/** A device's own signed statement of a session it runs. Signed by the device `signKey`. */
export interface ISessionDescriptor {
  readonly ctx: typeof IDENTITY_PURPOSES.sessionDesc;
  /** Opaque base64url session id. */
  readonly sessionId: string;
  readonly deviceId: string;
  /** Opaque base64url workspace claim. A claim, not a grant: it confers nothing by itself. */
  readonly workspaceClaim?: string;
  readonly startedAt: number;
  readonly expiresAt: number;
  readonly sig: string;
}

export function sessionDescriptorBytes(desc: Omit<ISessionDescriptor, 'sig' | 'ctx'>): Uint8Array {
  return canonicalBytes(IDENTITY_PURPOSES.sessionDesc, [
    desc.sessionId,
    desc.deviceId,
    desc.workspaceClaim ?? null,
    desc.startedAt,
    desc.expiresAt,
  ]);
}

const OPAQUE = /^[A-Za-z0-9_-]+$/;

function isOpaque(value: unknown, maxChars: number): value is string {
  return typeof value === 'string' && value.length <= maxChars && OPAQUE.test(value);
}

export function decodeSessionDescriptor(value: unknown): TDecoded<ISessionDescriptor> {
  const opened = openStatement(
    value,
    IDENTITY_PURPOSES.sessionDesc,
    ['sessionId', 'deviceId', 'startedAt', 'expiresAt', 'sig'],
    ['workspaceClaim'],
  );
  if (!opened.ok) return opened;
  const r = opened.value;
  if (!isOpaque(r['sessionId'], IDENTITY_STATEMENT_LIMITS.sessionIdChars)) {
    return malformed('sessionId');
  }
  if (!isId(r['deviceId'])) return malformed('deviceId');
  const hasClaim = Object.prototype.hasOwnProperty.call(r, 'workspaceClaim');
  const claim = r['workspaceClaim'];
  if (hasClaim && !isOpaque(claim, IDENTITY_STATEMENT_LIMITS.workspaceClaimChars)) {
    return malformed('workspaceClaim');
  }
  if (!isCount(r['startedAt'])) return malformed('startedAt');
  if (!isCount(r['expiresAt']) || r['expiresAt'] <= r['startedAt']) return malformed('expiresAt');
  if (!isSignature(r['sig'])) return malformed('sig');
  return {
    ok: true,
    value: {
      ctx: IDENTITY_PURPOSES.sessionDesc,
      sessionId: r['sessionId'],
      deviceId: r['deviceId'],
      ...(hasClaim ? { workspaceClaim: claim as string } : {}),
      startedAt: r['startedAt'],
      expiresAt: r['expiresAt'],
      sig: r['sig'],
    },
  };
}

export interface ISignSessionDescriptorOptions {
  readonly signPrivateKey: CryptoKey;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly workspaceClaim?: string;
  readonly startedAt: number;
  /** Defaults to `startedAt + SESSION_DESCRIPTOR_VALIDITY_MS`. */
  readonly expiresAt?: number;
}

export async function signSessionDescriptor(
  options: ISignSessionDescriptorOptions,
): Promise<ISessionDescriptor> {
  const unsigned = {
    sessionId: options.sessionId,
    deviceId: options.deviceId,
    ...(options.workspaceClaim !== undefined ? { workspaceClaim: options.workspaceClaim } : {}),
    startedAt: options.startedAt,
    expiresAt: options.expiresAt ?? options.startedAt + SESSION_DESCRIPTOR_VALIDITY_MS,
  };
  const sig = await signCanonical(options.signPrivateKey, sessionDescriptorBytes(unsigned));
  return { ctx: IDENTITY_PURPOSES.sessionDesc, ...unsigned, sig };
}
