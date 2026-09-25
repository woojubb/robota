/**
 * This device's private keys in the credential store: the device-signing key (when this device holds
 * it), the device's own signing key and its key-agreement key.
 *
 * Each record carries the public key it belongs to, and a loaded key is checked against the
 * certificate that names it — a signing key by signing and verifying, so a record that was swapped or
 * damaged is refused instead of issuing statements nobody can verify. A signing key is stored under
 * its own id, so a new one is written beside the old one and the old one is removed only after the
 * state that names the new one is saved.
 */
import { DeviceIdentityError } from './device-identity-error.js';

import type { ICredentialKey, ICredentialStore } from '@robota-sdk/agent-core';
import type {
  IDeviceCertificate,
  ISigningKey,
  ISigningKeyCertificate,
} from '@robota-sdk/agent-remote-pairing';

const webcrypto: Crypto = globalThis.crypto;
const SERVICE = 'robota.device-identity';
const RECORD_VERSION = 1;

type TKeyAlg = 'Ed25519' | 'ES256' | 'X25519';

interface IKeyRecord {
  readonly version: typeof RECORD_VERSION;
  readonly alg: TKeyAlg;
  /** base64url SPKI of the matching public key. */
  readonly publicKey: string;
  /** base64url PKCS#8 of the private key. */
  readonly pkcs8: string;
}

export const DEVICE_SIGN_KEY: ICredentialKey = { service: SERVICE, account: 'device-sign-key' };
export const DEVICE_KA_KEY: ICredentialKey = { service: SERVICE, account: 'device-ka-key' };

export function signingKeyCredentialKey(signingKeyId: string): ICredentialKey {
  return { service: SERVICE, account: `signing-key/${signingKeyId}` };
}

const IMPORT_PARAMS: Readonly<Record<TKeyAlg, AlgorithmIdentifier | EcKeyImportParams>> = {
  Ed25519: { name: 'Ed25519' },
  ES256: { name: 'ECDSA', namedCurve: 'P-256' },
  X25519: { name: 'X25519' },
};

const SIGN_PARAMS: Readonly<Record<'Ed25519' | 'ES256', AlgorithmIdentifier | EcdsaParams>> = {
  Ed25519: { name: 'Ed25519' },
  ES256: { name: 'ECDSA', hash: 'SHA-256' },
};

const b64u = (bytes: ArrayBuffer): string => Buffer.from(bytes).toString('base64url');

function algOf(key: CryptoKey): TKeyAlg {
  const algorithm = key.algorithm as EcKeyAlgorithm;
  if (algorithm.name === 'Ed25519') return 'Ed25519';
  if (algorithm.name === 'X25519') return 'X25519';
  if (algorithm.name === 'ECDSA' && algorithm.namedCurve === 'P-256') return 'ES256';
  throw new DeviceIdentityError('device identity: unsupported key algorithm');
}

/** Write an extractable keypair's private key; the value is never logged or put in an error. */
export async function storeKeyPair(
  store: ICredentialStore,
  key: ICredentialKey,
  keyPair: CryptoKeyPair,
): Promise<void> {
  const record: IKeyRecord = {
    version: RECORD_VERSION,
    alg: algOf(keyPair.privateKey),
    publicKey: b64u(await webcrypto.subtle.exportKey('spki', keyPair.publicKey)),
    pkcs8: b64u(await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey)),
  };
  await store.set(key, JSON.stringify(record));
}

async function readRecord(
  store: ICredentialStore,
  key: ICredentialKey,
  expected: { alg: TKeyAlg; publicKey: string },
): Promise<CryptoKey | undefined> {
  const raw = await store.get(key);
  if (raw === undefined) return undefined;
  let record: Partial<IKeyRecord>;
  try {
    record = JSON.parse(raw) as Partial<IKeyRecord>;
  } catch {
    throw new DeviceIdentityError(`device key ${key.service}/${key.account} is corrupt`);
  }
  if (
    record.version !== RECORD_VERSION ||
    record.alg !== expected.alg ||
    typeof record.pkcs8 !== 'string'
  ) {
    throw new DeviceIdentityError(`device key ${key.service}/${key.account} has an unexpected shape`);
  }
  // A key stored for another certificate is not this one's; it reads as absent, not as a match.
  if (record.publicKey !== expected.publicKey) return undefined;
  const usages: KeyUsage[] = expected.alg === 'X25519' ? ['deriveBits'] : ['sign'];
  try {
    return await webcrypto.subtle.importKey(
      'pkcs8',
      Buffer.from(record.pkcs8, 'base64url'),
      IMPORT_PARAMS[expected.alg],
      false,
      usages,
    );
  } catch {
    throw new DeviceIdentityError(`device key ${key.service}/${key.account} is not a usable key`);
  }
}

/** Whether `privateKey` signs what the certified `publicKeySpki` verifies. */
async function provesPossession(
  alg: 'Ed25519' | 'ES256',
  privateKey: CryptoKey,
  publicKeySpki: string,
): Promise<boolean> {
  const publicKey = await webcrypto.subtle.importKey(
    'spki',
    Buffer.from(publicKeySpki, 'base64url'),
    IMPORT_PARAMS[alg],
    false,
    ['verify'],
  );
  const probe = webcrypto.getRandomValues(new Uint8Array(32));
  const signature = await webcrypto.subtle.sign(SIGN_PARAMS[alg], privateKey, probe);
  return webcrypto.subtle.verify(SIGN_PARAMS[alg], publicKey, signature, probe);
}

/** The signing key `certificate` names, when this device's store holds it. */
export async function loadSigningKey(
  store: ICredentialStore,
  certificate: ISigningKeyCertificate,
): Promise<ISigningKey | undefined> {
  const privateKey = await readRecord(store, signingKeyCredentialKey(certificate.signingKeyId), {
    alg: certificate.alg,
    publicKey: certificate.publicKey,
  });
  if (privateKey === undefined) return undefined;
  if (!(await provesPossession(certificate.alg, privateKey, certificate.publicKey))) {
    throw new DeviceIdentityError('the stored signing key does not match its certificate');
  }
  return { certificate, privateKey };
}

/** Whether this device's store holds the private keys its certificate names. */
export async function holdsDeviceKeys(
  store: ICredentialStore,
  certificate: IDeviceCertificate,
): Promise<boolean> {
  const sign = await readRecord(store, DEVICE_SIGN_KEY, { alg: 'ES256', publicKey: certificate.signKey });
  if (sign === undefined || !(await provesPossession('ES256', sign, certificate.signKey))) return false;
  const ka = await readRecord(store, DEVICE_KA_KEY, { alg: 'X25519', publicKey: certificate.kaKey });
  return ka !== undefined;
}

/** A public key from a certificate's SPKI, for re-certifying the same device keys. */
export function importPublicKey(alg: 'ES256' | 'X25519', spki: string): Promise<CryptoKey> {
  return webcrypto.subtle.importKey(
    'spki',
    Buffer.from(spki, 'base64url'),
    IMPORT_PARAMS[alg],
    true,
    alg === 'X25519' ? [] : ['verify'],
  );
}
