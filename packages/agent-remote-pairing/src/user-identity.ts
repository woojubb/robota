/**
 * SEC-011 (#1812): proving two DEVICES belong to one USER.
 *
 * ## The question nothing here answered before
 *
 * `device-identity.ts` proves possession of a machine's private key. `ITrustedDeviceRecord` records
 * that a machine was enrolled somewhere once. A completed WebRTC connection proves two endpoints
 * negotiated a channel. None of the three says *whose* machine — and a cross-computer hand-off must
 * not move a session to a device belonging to someone else.
 *
 * ## Why the proof travels with the DESTINATION
 *
 * The tempting shortcut is transitive trust: if the source has both devices in its trusted-device
 * store, call them the same user. That inverts the direction of the proof — the list lives on the
 * machine making the claim, so a mistaken or compromised source can assert any destination is its
 * user's, while the destination presents nothing. It is an authorization list wearing an
 * authentication's clothes.
 *
 * So: the user holds one ROOT keypair, and each device's identity public key is signed by it. A
 * device proves same-user by presenting that certificate and demonstrating possession of the device
 * private key. Same root ⇒ same user, checkable by anyone holding the root public key, offline.
 *
 * ## What is deliberately NOT here
 *
 * No account service. The issue says user credentials needing a platform service belong behind an
 * injected port rather than in the contract, and a local-first tool should not put a network round
 * trip on the critical path of a hand-off between two machines on one desk. An OIDC-backed
 * implementation can satisfy the same port later.
 *
 * Isomorphic and dependency-free, like the rest of this package: WebCrypto ECDSA-P256, the same
 * primitives the reconnect challenge already uses.
 */

import { deriveIdentityId, exportPublicKey, importPublicKey } from './device-identity.js';

const ECDSA_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

const webcrypto = globalThis.crypto;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * A device certificate: this device key belongs to this user root.
 *
 * `signature` covers the CANONICAL SERIALISATION of every other field — see `certificateBytes`. A
 * signature over only the device key would let an attacker keep a valid signature while changing the
 * label or the issue time, which is the class of defect this file exists to close.
 */
export interface IUserDeviceCertificate {
  /** base64url `SHA-256(SPKI)` of the USER root public key — who this asserts the device belongs to. */
  readonly userId: string;
  /** base64url `SHA-256(SPKI)` of the DEVICE public key. */
  readonly deviceId: string;
  /** base64url SPKI of the device public key, so a verifier needs nothing else to check possession. */
  readonly devicePublicKey: string;
  /** Milliseconds since the epoch. */
  readonly issuedAt: number;
  /** Milliseconds since the epoch. A certificate past this is refused however intact its signature. */
  readonly expiresAt: number;
  /** base64url ECDSA signature by the user root private key. */
  readonly signature: string;
}

/** The bytes a certificate signature covers. Every field but the signature itself, in a fixed order. */
function certificateBytes(cert: Omit<IUserDeviceCertificate, 'signature'>): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      'robota.user-device-certificate.v1',
      cert.userId,
      cert.deviceId,
      cert.devicePublicKey,
      cert.issuedAt,
      cert.expiresAt,
    ]),
  );
}

/** Generate a user ROOT keypair. Distinct from a device keypair in role, not in algorithm. */
export function generateUserRootKeyPair(extractable: boolean): Promise<CryptoKeyPair> {
  return webcrypto.subtle.generateKey(ECDSA_PARAMS, extractable, [
    'sign',
    'verify',
  ]) as Promise<CryptoKeyPair>;
}

/**
 * The stable, non-secret id of a user root — `SHA-256(SPKI)`, the same derivation devices use.
 *
 * Takes the KEY and exports it here, rather than making every caller remember that
 * `deriveIdentityId` wants a base64url SPKI string. One conversion, in the place that knows.
 */
export async function deriveUserId(rootPublicKey: CryptoKey): Promise<string> {
  return deriveIdentityId(await exportPublicKey(rootPublicKey));
}

export interface IIssueCertificateOptions {
  readonly rootPrivateKey: CryptoKey;
  readonly userId: string;
  readonly devicePublicKey: CryptoKey;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Sign a device key into this user's set. */
export async function issueDeviceCertificate(
  options: IIssueCertificateOptions,
): Promise<IUserDeviceCertificate> {
  const devicePublicKeySpki = await exportPublicKey(options.devicePublicKey);
  const deviceId = await deriveIdentityId(devicePublicKeySpki);
  const unsigned = {
    userId: options.userId,
    deviceId,
    devicePublicKey: devicePublicKeySpki,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
  };
  const signature = await webcrypto.subtle.sign(
    SIGN_PARAMS,
    options.rootPrivateKey,
    certificateBytes(unsigned) as unknown as ArrayBuffer,
  );
  return { ...unsigned, signature: toBase64Url(new Uint8Array(signature)) };
}

/** Why a certificate was not accepted. A closed vocabulary so a caller cannot invent a softer reading. */
export type TCertificateRejection =
  'signature-invalid' | 'user-mismatch' | 'expired' | 'not-yet-valid' | 'revoked';

export interface ICertificateVerification {
  readonly valid: boolean;
  readonly deviceId?: string;
  readonly rejection?: TCertificateRejection;
}

export interface IVerifyCertificateOptions {
  readonly rootPublicKey: CryptoKey;
  /** The user this verifier expects. A certificate for a different root is a different person. */
  readonly expectedUserId: string;
  readonly now: number;
  /** Device ids retired by the user. A revoked id fails even with an intact signature. */
  readonly revokedDeviceIds?: readonly string[];
}

/**
 * Verify that a certificate really binds its device to the expected user, right now.
 *
 * Order matters and is deliberate: the signature is checked FIRST, so every later decision is made
 * about fields that were actually signed. Checking expiry or revocation before the signature would
 * mean reasoning about attacker-controlled values.
 */
export async function verifyDeviceCertificate(
  certificate: IUserDeviceCertificate,
  options: IVerifyCertificateOptions,
): Promise<ICertificateVerification> {
  const { signature, ...unsigned } = certificate;
  const signatureOk = await webcrypto.subtle.verify(
    SIGN_PARAMS,
    options.rootPublicKey,
    fromBase64Url(signature) as unknown as ArrayBuffer,
    certificateBytes(unsigned) as unknown as ArrayBuffer,
  );
  if (!signatureOk) return { valid: false, rejection: 'signature-invalid' };

  // Now — and only now — the fields are known to be the ones the root signed.
  if (certificate.userId !== options.expectedUserId) {
    return { valid: false, rejection: 'user-mismatch' };
  }
  if (options.now < certificate.issuedAt) return { valid: false, rejection: 'not-yet-valid' };
  if (options.now >= certificate.expiresAt) return { valid: false, rejection: 'expired' };
  if (options.revokedDeviceIds?.includes(certificate.deviceId) === true) {
    return { valid: false, rejection: 'revoked' };
  }
  return { valid: true, deviceId: certificate.deviceId };
}

/**
 * Confirm the presenter actually HOLDS the device private key the certificate names.
 *
 * A certificate alone proves nothing about who is presenting it — it is a public document. Without
 * this step, anyone who observed a certificate could replay it, which is why the two are separate
 * calls that a caller must make in sequence rather than one that looks complete on its own.
 */
export async function verifyDevicePossession(
  certificate: IUserDeviceCertificate,
  challenge: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const devicePublicKey = await importPublicKey(certificate.devicePublicKey);
  return webcrypto.subtle.verify(
    SIGN_PARAMS,
    devicePublicKey,
    signature as unknown as ArrayBuffer,
    challenge as unknown as ArrayBuffer,
  );
}
