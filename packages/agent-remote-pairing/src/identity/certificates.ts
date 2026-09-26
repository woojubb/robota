/**
 * The two certificates of the identity chain: master → signing key, and signing key → device.
 *
 * The master key certifies a signing key; the signing key certifies devices and issues the roster
 * and revocation lists. Keeping the master out of day-to-day issuing is what lets it stay unstored:
 * adding or retiring a device needs only the signing key, which lives on a trusted device and
 * expires on its own.
 */

import { webcrypto } from '../crypto-primitives.js';
import {
  DAY_MS,
  IDENTITY_PURPOSES,
  canonicalBytes,
  exportSpki,
  isCount,
  isId,
  isSignature,
  isSpki,
  keyIdOf,
  malformed,
  openStatement,
  signCanonical,
  signatureAlgOf,
  sortedUnique,
  type TDecoded,
  type TSignatureAlg,
} from './encoding.js';

/** Default lifetime of a signing-key certificate. */
export const SIGNING_KEY_CERTIFICATE_VALIDITY_MS = 90 * DAY_MS;
/** Default lifetime of a device certificate. */
export const DEVICE_CERTIFICATE_VALIDITY_MS = 90 * DAY_MS;

/** What a device may be asked to do. The verifier intersects this with local policy. */
export const DEVICE_CAPABILITIES = [
  'delegate',
  'drive',
  'file',
  'handoff',
  'message',
  'observe',
  'presence',
] as const;
export type TDeviceCapability = (typeof DEVICE_CAPABILITIES)[number];

/** A device name is a short human label; it is signed, so it is bounded and has one encoding. */
export const DEVICE_NAME_MAX_CHARS = 64;

// ── Signing-key certificate ─────────────────────────────────────────────────────────────────────

export interface ISigningKeyCertificate {
  readonly ctx: typeof IDENTITY_PURPOSES.signingKeyCert;
  readonly userId: string;
  /** base64url `SHA-256(SPKI)` of `publicKey`. */
  readonly signingKeyId: string;
  readonly alg: TSignatureAlg;
  /** base64url SPKI of the signing public key. */
  readonly publicKey: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** Master-key signature over every field above. */
  readonly sig: string;
}

export function signingKeyCertificateBytes(
  cert: Omit<ISigningKeyCertificate, 'sig' | 'ctx'>,
): Uint8Array {
  return canonicalBytes(IDENTITY_PURPOSES.signingKeyCert, [
    cert.userId,
    cert.signingKeyId,
    cert.alg,
    cert.publicKey,
    cert.issuedAt,
    cert.expiresAt,
  ]);
}

const SIGNING_KEY_CERT_FIELDS = [
  'userId',
  'signingKeyId',
  'alg',
  'publicKey',
  'issuedAt',
  'expiresAt',
  'sig',
] as const;

export function decodeSigningKeyCertificate(value: unknown): TDecoded<ISigningKeyCertificate> {
  const opened = openStatement(value, IDENTITY_PURPOSES.signingKeyCert, SIGNING_KEY_CERT_FIELDS);
  if (!opened.ok) return opened;
  const r = opened.value;
  if (!isId(r['userId'])) return malformed('userId');
  if (!isId(r['signingKeyId'])) return malformed('signingKeyId');
  const alg = r['alg'];
  if (alg !== 'Ed25519' && alg !== 'ES256') return malformed('alg');
  if (!isSpki(r['publicKey'], alg === 'ES256' ? 'P256' : 'Ed25519')) return malformed('publicKey');
  if (!isCount(r['issuedAt'])) return malformed('issuedAt');
  if (!isCount(r['expiresAt']) || r['expiresAt'] <= r['issuedAt']) return malformed('expiresAt');
  if (!isSignature(r['sig'])) return malformed('sig');
  return {
    ok: true,
    value: {
      ctx: IDENTITY_PURPOSES.signingKeyCert,
      userId: r['userId'],
      signingKeyId: r['signingKeyId'],
      alg,
      publicKey: r['publicKey'],
      issuedAt: r['issuedAt'],
      expiresAt: r['expiresAt'],
      sig: r['sig'],
    },
  };
}

/** Generate a signing keypair. `extractable` only when the caller must persist it (a keychain). */
export function generateSigningKeyPair(options: {
  readonly alg?: TSignatureAlg;
  readonly extractable: boolean;
}): Promise<CryptoKeyPair> {
  const params =
    (options.alg ?? 'Ed25519') === 'ES256'
      ? { name: 'ECDSA', namedCurve: 'P-256' }
      : { name: 'Ed25519' };
  return webcrypto.subtle.generateKey(params, options.extractable, [
    'sign',
    'verify',
  ]) as Promise<CryptoKeyPair>;
}

export interface ICertifySigningKeyOptions {
  readonly masterPrivateKey: CryptoKey;
  readonly userId: string;
  readonly signingPublicKey: CryptoKey;
  readonly issuedAt: number;
  /** Defaults to `issuedAt + SIGNING_KEY_CERTIFICATE_VALIDITY_MS`. */
  readonly expiresAt?: number;
}

/** Master-sign a signing key into this user's chain. */
export async function certifySigningKey(
  options: ICertifySigningKeyOptions,
): Promise<ISigningKeyCertificate> {
  const alg = signatureAlgOf(options.signingPublicKey);
  if (alg === undefined) throw new Error('signing key: unsupported algorithm');
  const unsigned = {
    userId: options.userId,
    signingKeyId: await keyIdOf(options.signingPublicKey),
    alg,
    publicKey: await exportSpki(options.signingPublicKey),
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt ?? options.issuedAt + SIGNING_KEY_CERTIFICATE_VALIDITY_MS,
  };
  const sig = await signCanonical(options.masterPrivateKey, signingKeyCertificateBytes(unsigned));
  return { ctx: IDENTITY_PURPOSES.signingKeyCert, ...unsigned, sig };
}

/** A signing key ready to issue: its certificate and its private key. */
export interface ISigningKey {
  readonly certificate: ISigningKeyCertificate;
  readonly privateKey: CryptoKey;
}

// ── Device certificate ──────────────────────────────────────────────────────────────────────────

export interface IDeviceCertificate {
  readonly ctx: typeof IDENTITY_PURPOSES.deviceCert;
  readonly userId: string;
  readonly signingKeyId: string;
  /** base64url `SHA-256(signKey SPKI)`. */
  readonly deviceId: string;
  /** Algorithm of `signKey`. */
  readonly alg: 'ES256';
  /** base64url SPKI of the device's ECDSA P-256 signing key. */
  readonly signKey: string;
  /** Algorithm of `kaKey`, which is for key agreement only and never signs. */
  readonly kaAlg: 'X25519';
  readonly kaKey: string;
  /** Rotation counter of `kaKey`. */
  readonly kaEpoch: number;
  readonly name: string;
  /** Strictly ascending. */
  readonly capabilities: readonly TDeviceCapability[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** Signing-key signature over every field above. */
  readonly sig: string;
}

/** The signed field list of a device certificate, reused when a roster embeds one. */
export function deviceCertificateFields(
  cert: Omit<IDeviceCertificate, 'sig' | 'ctx'>,
): (string | number | readonly string[])[] {
  return [
    cert.userId,
    cert.signingKeyId,
    cert.deviceId,
    cert.alg,
    cert.signKey,
    cert.kaAlg,
    cert.kaKey,
    cert.kaEpoch,
    cert.name,
    cert.capabilities,
    cert.issuedAt,
    cert.expiresAt,
  ];
}

export function deviceCertificateBytes(cert: Omit<IDeviceCertificate, 'sig' | 'ctx'>): Uint8Array {
  return canonicalBytes(IDENTITY_PURPOSES.deviceCert, deviceCertificateFields(cert));
}

const DEVICE_CERT_FIELDS = [
  'userId',
  'signingKeyId',
  'deviceId',
  'alg',
  'signKey',
  'kaAlg',
  'kaKey',
  'kaEpoch',
  'name',
  'capabilities',
  'issuedAt',
  'expiresAt',
  'sig',
] as const;

const CONTROL_CHARACTER = /\p{Cc}/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function isDeviceName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= DEVICE_NAME_MAX_CHARS &&
    !CONTROL_CHARACTER.test(value) &&
    !LONE_SURROGATE.test(value) &&
    value.normalize('NFC') === value
  );
}

const CAPABILITY_SET: ReadonlySet<string> = new Set(DEVICE_CAPABILITIES);

function isCapabilities(value: unknown): value is readonly TDeviceCapability[] {
  if (!Array.isArray(value) || value.length > DEVICE_CAPABILITIES.length) return false;
  for (let i = 0; i < value.length; i += 1) {
    const item: unknown = value[i];
    if (typeof item !== 'string' || !CAPABILITY_SET.has(item)) return false;
    if (i > 0 && !((value[i - 1] as string) < item)) return false;
  }
  return true;
}

export function decodeDeviceCertificate(value: unknown): TDecoded<IDeviceCertificate> {
  const opened = openStatement(value, IDENTITY_PURPOSES.deviceCert, DEVICE_CERT_FIELDS);
  if (!opened.ok) return opened;
  const r = opened.value;
  if (!isId(r['userId'])) return malformed('userId');
  if (!isId(r['signingKeyId'])) return malformed('signingKeyId');
  if (!isId(r['deviceId'])) return malformed('deviceId');
  if (r['alg'] !== 'ES256') return malformed('alg');
  if (!isSpki(r['signKey'], 'P256')) return malformed('signKey');
  if (r['kaAlg'] !== 'X25519') return malformed('kaAlg');
  if (!isSpki(r['kaKey'], 'X25519')) return malformed('kaKey');
  if (!isCount(r['kaEpoch'])) return malformed('kaEpoch');
  if (!isDeviceName(r['name'])) return malformed('name');
  if (!isCapabilities(r['capabilities'])) return malformed('capabilities');
  if (!isCount(r['issuedAt'])) return malformed('issuedAt');
  if (!isCount(r['expiresAt']) || r['expiresAt'] <= r['issuedAt']) return malformed('expiresAt');
  if (!isSignature(r['sig'])) return malformed('sig');
  return {
    ok: true,
    value: {
      ctx: IDENTITY_PURPOSES.deviceCert,
      userId: r['userId'],
      signingKeyId: r['signingKeyId'],
      deviceId: r['deviceId'],
      alg: 'ES256',
      signKey: r['signKey'],
      kaAlg: 'X25519',
      kaKey: r['kaKey'],
      kaEpoch: r['kaEpoch'],
      name: r['name'],
      capabilities: [...r['capabilities']],
      issuedAt: r['issuedAt'],
      expiresAt: r['expiresAt'],
      sig: r['sig'],
    },
  };
}

/** Generate a device's ECDSA P-256 signing keypair (the key its `deviceId` is derived from). */
export function generateDeviceSignKeyPair(extractable: boolean): Promise<CryptoKeyPair> {
  return webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, extractable, [
    'sign',
    'verify',
  ]) as Promise<CryptoKeyPair>;
}

/** Generate a device's X25519 key-agreement keypair. It derives shared secrets and never signs. */
export function generateDeviceKeyAgreementKeyPair(extractable: boolean): Promise<CryptoKeyPair> {
  return webcrypto.subtle.generateKey({ name: 'X25519' }, extractable, [
    'deriveBits',
  ]) as Promise<CryptoKeyPair>;
}

export interface ICertifyDeviceOptions {
  readonly signingKey: ISigningKey;
  readonly signPublicKey: CryptoKey;
  readonly kaPublicKey: CryptoKey;
  readonly kaEpoch: number;
  readonly name: string;
  readonly capabilities: readonly TDeviceCapability[];
  readonly issuedAt: number;
  /** Defaults to `issuedAt + DEVICE_CERTIFICATE_VALIDITY_MS`. */
  readonly expiresAt?: number;
}

/** Signing-key-sign a device into this user's set. */
export async function certifyDevice(options: ICertifyDeviceOptions): Promise<IDeviceCertificate> {
  if (signatureAlgOf(options.signPublicKey) !== 'ES256') {
    throw new Error('device certificate: signKey must be ECDSA P-256');
  }
  if (options.kaPublicKey.algorithm.name !== 'X25519') {
    throw new Error('device certificate: kaKey must be X25519');
  }
  if (!isDeviceName(options.name)) throw new Error('device certificate: invalid name');
  const issuer = options.signingKey.certificate;
  const unsigned = {
    userId: issuer.userId,
    signingKeyId: issuer.signingKeyId,
    deviceId: await keyIdOf(options.signPublicKey),
    alg: 'ES256' as const,
    signKey: await exportSpki(options.signPublicKey),
    kaAlg: 'X25519' as const,
    kaKey: await exportSpki(options.kaPublicKey),
    kaEpoch: options.kaEpoch,
    name: options.name,
    capabilities: sortedUnique(options.capabilities),
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt ?? options.issuedAt + DEVICE_CERTIFICATE_VALIDITY_MS,
  };
  const sig = await signCanonical(options.signingKey.privateKey, deviceCertificateBytes(unsigned));
  return { ctx: IDENTITY_PURPOSES.deviceCert, ...unsigned, sig };
}
