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

/**
 * A runtime instance for the owner-link known answers: the Ed25519 key from seed bytes 0x40..0x5f,
 * a binding shaped like a supervised runtime's, and the certificate the fixture keyring's attach key
 * makes for them. Cross-checked outside this package (HKDF in Python, the public key and the
 * signature from the openssl CLI).
 */
export const KAT_INSTANCE_SEED: Buffer = Buffer.from(
  Array.from({ length: 32 }, (_, i) => 0x40 + i),
);
export const KAT_INSTANCE_PUBLIC_KEY_HEX =
  '2543b92ff1095511476adc8369db6ddc933665a11978dda1404ee1066ca9559d';
export const KAT_BINDING = {
  runtimeId: '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f',
  generation: 'AAECAwQFBgcICQoLDA0ODw',
} as const;
export const KAT_CERTIFICATE_HEX =
  '9d76a228a4824881c96050ff31eaa9287dc99efe238c592aab67189ef16fe5b6' +
  'ad90e67b84f5334e771534ec0496d9a5edeae8568c0f92d73a3ae252638e1302';
/** The certificate for the same instance and runtime id at the next generation. */
export const KAT_CERTIFICATE_NEXT_GENERATION_HEX =
  'fad24766d3f13d910825aa39016bc203bd5a7237d77e4037189389f28735b1ac' +
  'ca9f41b16a9bdfba3fdc61b0b4bc2dc58bf1cd787834c7232d164ed4bd6b8c06';
export const KAT_NEXT_GENERATION = 'AAECAwQFBgcICQoLDA0OEA';

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

/** Joins parts with a 2-byte big-endian length before each, written here apart from the package's own. */
export function lengthPrefixed(...parts: readonly Uint8Array[]): Buffer {
  return Buffer.concat(
    parts.flatMap((part) => {
      const prefix = Buffer.alloc(2);
      prefix.writeUInt16BE(part.length);
      return [prefix, Buffer.from(part)];
    }),
  );
}

/**
 * Every value reachable from `root` through its own properties and the getters of its prototype
 * chain, two levels deep: what a holder of the object can get at without a package-private accessor.
 */
export function reachableValues(root: object): unknown[] {
  const found: unknown[] = [];
  const visit = (value: unknown, depth: number): void => {
    found.push(value);
    if (depth === 0 || typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) {
      return;
    }
    const names = new Set<string | symbol>();
    for (
      let prototype: object | null = value;
      prototype !== null && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      for (const name of Reflect.ownKeys(prototype)) names.add(name);
    }
    for (const name of names) {
      if (name === 'constructor') continue;
      let child: unknown;
      try {
        child = (value as Record<string | symbol, unknown>)[name];
      } catch {
        continue;
      }
      if (typeof child !== 'function') visit(child, depth - 1);
    }
  };
  visit(root, 2);
  return found;
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
