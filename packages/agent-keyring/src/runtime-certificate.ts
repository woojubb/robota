/**
 * What a runtime is, as its owner vouches for it: an instance key bound to one runtime start.
 *
 * A runtime cannot prove it belongs to the owner by anything it can show on its own, because every
 * same-user program can show the same things: a file, a socket path, a registration. So the owner
 * signs, with the attach key only the passphrase reaches, the runtime's memory-only instance key
 * together with the start it belongs to (the binding). A client that later checks this certificate
 * under the attach key it derived itself knows the runtime is one its owner certified, for exactly
 * this start; a certificate made by any other keyring, or for any other instance or start, fails.
 */
import { Buffer } from 'node:buffer';

import { concatLengthPrefixed, isBytes, utf8 } from './bytes.js';
import { KeyringError } from './errors.js';
import { KEY_BYTES } from './kdf.js';
import { SIGNATURE_BYTES, verifyEd25519 } from './signatures.js';

/** The runtime start a link and a certificate are bound to. Public values. */
export interface ILinkBinding {
  readonly runtimeId: string;
  readonly generation: string;
}

/**
 * What a runtime is told about its owner by its spawner: the owner's attach public key and the
 * certificate of the runtime's own instance key. Public values, held only in runtime memory: a
 * same-user-writable file is never a trust anchor.
 */
export interface ITrustRoot {
  readonly attachPublicKey: Uint8Array;
  /** Ed25519 under the attach key over the certificate message (see {@link runtimeCertificateMessage}). */
  readonly certificate: Uint8Array;
}

/** Versioned like every derivation label: a certificate of one version never verifies as another. */
export const RUNTIME_CERTIFICATE_LABEL = 'robota/link/v1/runtime-cert';

/** The longest runtime id or generation a binding carries. */
export const MAX_BINDING_PART_LENGTH = 128;

// Printable ASCII without separators: what a registration's ids are made of, and nothing a
// terminal, a log line or a length prefix could read twice.
const BINDING_PART_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const BINDING_KEYS = ['generation', 'runtimeId'];

function isBindingPart(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BINDING_PART_LENGTH &&
    BINDING_PART_PATTERN.test(value)
  );
}

/**
 * A fresh binding built from `value`, or `invalid-argument`. Exactly the two fields, each 1 to
 * {@link MAX_BINDING_PART_LENGTH} characters of `[A-Za-z0-9._:-]`, so every binding has one byte
 * spelling and a decoder never meets a value it would have to reinterpret.
 */
export function checkLinkBinding(value: unknown): ILinkBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new KeyringError('invalid-argument', 'A link binding is a runtime id and a generation.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== BINDING_KEYS.length ||
    keys.some((key, index) => key !== BINDING_KEYS[index]) ||
    !isBindingPart(record['runtimeId']) ||
    !isBindingPart(record['generation'])
  ) {
    throw new KeyringError(
      'invalid-argument',
      `A link binding's runtime id and generation are 1-${MAX_BINDING_PART_LENGTH} characters of [A-Za-z0-9._:-].`,
    );
  }
  return { runtimeId: record['runtimeId'], generation: record['generation'] };
}

/** The bytes of a binding part as it is decoded from the wire, or `undefined` when it is not one. */
export function decodeBindingPart(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0 || bytes.length > MAX_BINDING_PART_LENGTH) return undefined;
  // ASCII only, so latin1 maps each byte to exactly the character the pattern then checks.
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  return isBindingPart(text) ? text : undefined;
}

export function requireInstanceKey(value: unknown): Uint8Array {
  if (!isBytes(value) || value.length !== KEY_BYTES) {
    throw new KeyringError('invalid-argument', 'An instance public key is exactly 32 bytes.');
  }
  return value;
}

/** `label | instance key | runtime id | generation`, each part length-prefixed. */
export function runtimeCertificateMessage(
  instancePublicKey: Uint8Array,
  binding: ILinkBinding,
): Buffer {
  const instance = requireInstanceKey(instancePublicKey);
  const checked = checkLinkBinding(binding);
  return concatLengthPrefixed([
    utf8(RUNTIME_CERTIFICATE_LABEL),
    instance,
    utf8(checked.runtimeId),
    utf8(checked.generation),
  ]);
}

/** Whether `root` certifies `instancePublicKey` for `binding` under the attach key `root` names. */
export function certifies(
  root: ITrustRoot,
  instancePublicKey: Uint8Array,
  binding: ILinkBinding,
): boolean {
  if (
    !isBytes(root.attachPublicKey) ||
    root.attachPublicKey.length !== KEY_BYTES ||
    !isBytes(root.certificate) ||
    root.certificate.length !== SIGNATURE_BYTES
  ) {
    return false;
  }
  return verifyEd25519(
    root.attachPublicKey,
    runtimeCertificateMessage(instancePublicKey, binding),
    root.certificate,
  );
}
