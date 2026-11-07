import { Buffer } from 'node:buffer';
import { hkdfSync, scrypt } from 'node:crypto';

import { utf8 } from './bytes.js';
import { KeyringError } from './errors.js';

export const KEY_BYTES = 32;
export const SCRYPT_SALT_BYTES = 16;

export interface IScryptParameters {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/** The cost a new passphrase slot is written with (OWASP's scrypt baseline, ~128 MiB, ~160 ms). */
export const DEFAULT_SCRYPT_PARAMETERS: IScryptParameters = { N: 2 ** 17, r: 8, p: 1 };

/**
 * The cost range an unlock accepts. The floor stops a hostile keyring from downgrading the work
 * factor; the ceiling stops one from making unlock allocate gigabytes or run for minutes. The file
 * is writable by every program of the user, so the memory a keyring may ask for is capped at 512 MiB
 * (four times the default) however N and r are combined. All of it is checked before any key
 * derivation starts.
 */
export const SCRYPT_BOUNDS = {
  minN: 2 ** 15,
  maxN: 2 ** 19,
  minR: 8,
  maxR: 16,
  p: 1,
  maxMemoryBytes: 2 ** 29,
} as const;

const SCRYPT_BLOCK_BYTES = 128;
const SCRYPT_MEMORY_HEADROOM_BYTES = 1024 * 1024;

export function assertScryptParametersInBounds(parameters: IScryptParameters): void {
  const { N, r, p } = parameters;
  const nInBounds =
    Number.isInteger(N) &&
    N >= SCRYPT_BOUNDS.minN &&
    N <= SCRYPT_BOUNDS.maxN &&
    (N & (N - 1)) === 0;
  const rInBounds = Number.isInteger(r) && r >= SCRYPT_BOUNDS.minR && r <= SCRYPT_BOUNDS.maxR;
  const memoryInBounds = SCRYPT_BLOCK_BYTES * r * N <= SCRYPT_BOUNDS.maxMemoryBytes;
  if (!nInBounds || !rInBounds || !memoryInBounds || p !== SCRYPT_BOUNDS.p) {
    throw new KeyringError(
      'kdf-parameters-out-of-bounds',
      'A passphrase slot requests scrypt parameters outside the accepted range.',
    );
  }
}

/**
 * NFKC then UTF-8, so the same typed text unlocks on every platform and keyboard layout. Only the
 * empty string is refused; length and strength policy belong to the caller. The returned buffer is
 * the caller's to wipe (the JavaScript string it came from cannot be wiped).
 */
export function normalizePassphrase(passphrase: unknown): Buffer {
  if (typeof passphrase !== 'string') {
    throw new KeyringError('invalid-argument', 'The passphrase must be a string.');
  }
  const normalized = passphrase.normalize('NFKC');
  if (normalized.length === 0) {
    throw new KeyringError('empty-passphrase', 'The passphrase is empty.');
  }
  return utf8(normalized);
}

/**
 * Derives the passphrase slot's key-encryption key. Asynchronous (`crypto.scrypt` runs on the
 * libuv thread pool) so ~160 ms of work never blocks the caller's event loop.
 */
export function deriveKeyFromPassphrase(
  passphrase: Uint8Array,
  salt: Uint8Array,
  parameters: IScryptParameters,
): Promise<Buffer> {
  assertScryptParametersInBounds(parameters);
  const { N, r, p } = parameters;
  // scrypt needs ~128*r*(N+p+2) bytes; Node refuses unless maxmem is above that.
  const maxmem = SCRYPT_BLOCK_BYTES * r * (N + p + 2) + SCRYPT_MEMORY_HEADROOM_BYTES;
  return new Promise<Buffer>((resolve, reject) => {
    try {
      scrypt(passphrase, salt, KEY_BYTES, { N, r, p, maxmem }, (error, derivedKey) => {
        if (error) reject(kdfFailed());
        else resolve(derivedKey);
      });
    } catch {
      reject(kdfFailed());
    }
  });
}

function kdfFailed(): KeyringError {
  return new KeyringError('kdf-failed', 'The key derivation could not run on this host.');
}

/** HKDF-SHA256 to 32 bytes. An empty salt is RFC 5869's "no salt" (a string of zero bytes). */
export function hkdf32(
  inputKeyMaterial: Uint8Array,
  info: string | Uint8Array,
  salt: Uint8Array = new Uint8Array(0),
): Buffer {
  try {
    return Buffer.from(hkdfSync('sha256', inputKeyMaterial, salt, info, KEY_BYTES));
  } catch {
    throw kdfFailed();
  }
}
