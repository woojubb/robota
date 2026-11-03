import { Buffer } from 'node:buffer';

import { KeyringError, type TKeyringErrorCode } from '../index.js';

/** Bytes 0x00..0x1f. A fixed master key makes derived keys comparable with the known-answer values. */
export const FIXED_MASTER_KEY: Buffer = Buffer.from(Array.from({ length: 32 }, (_, i) => i));

/** Public keys derived from FIXED_MASTER_KEY, cross-checked outside this package (HMAC-based HKDF in Python, public keys from the openssl CLI). */
export const KNOWN_SEALING_PUBLIC_KEY_HEX =
  '4b73c35676631b6307fb28a3f70aaf47c331b86ada4996ce2f3c9f5c04cdba7a';
export const KNOWN_ATTACH_PUBLIC_KEY_HEX =
  '92ffeb9a3ccccde96ea227ff3e2f467989d8fdc5b234e8fdcf1d159a7f56ad54';
/** The authorship HMAC key FIXED_MASTER_KEY derives, and its tag of {@link KNOWN_AUTHORSHIP_MESSAGE}, cross-checked in Python (hmac, hashlib). */
export const KNOWN_AUTHORSHIP_KEY_HEX =
  '645f0686ee7ef6c5073ec8930c220db556c495be7dfdbd07f56226a0bf34e4a1';
export const KNOWN_AUTHORSHIP_MESSAGE = 'robota/keyring known-answer authorship message v1';
export const KNOWN_AUTHORSHIP_TAG_HEX =
  '5067021c80974a4875b70314442ef0f6cfffe90dad155dfa9bcbe72644f0749d';

export const FIXTURE_RECOVERY_KEY_BYTES: Buffer = Buffer.from(
  Array.from({ length: 20 }, (_, i) => 0xa0 + i),
);
export const FIXTURE_RECOVERY_KEY = 'M2GT-58X4-MPKA-FA59-NANT-SBDE-NYRB-3CNK';
/** Decomposed letters plus compatibility characters; NFKC turns it into `Pässwörd-fixture-1`. */
export const FIXTURE_PASSPHRASE_AS_TYPED = 'Pässwörd-ﬁxture-①';

export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function bytesOf(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

/** A copy of `bytes` with `mask` XOR-ed into the byte at `index`. */
export function tamper(bytes: Uint8Array, index: number, mask = 0x01): Buffer {
  const copy = Buffer.from(bytes);
  copy[index] ^= mask;
  return copy;
}

/** The `code` of the KeyringError a call throws; any other throw (or none) fails the test loudly. */
export function codeOf(call: () => unknown): TKeyringErrorCode {
  try {
    call();
  } catch (error) {
    if (error instanceof KeyringError) return error.code;
    throw error;
  }
  throw new Error('Expected a KeyringError but nothing was thrown.');
}

export async function codeOfAsync(promise: Promise<unknown>): Promise<TKeyringErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof KeyringError) return error.code;
    throw error;
  }
  throw new Error('Expected a KeyringError but nothing was thrown.');
}
