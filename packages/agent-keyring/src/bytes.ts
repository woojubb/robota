import { Buffer } from 'node:buffer';

import { KeyringError } from './errors.js';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const LENGTH_PREFIX_BYTES = 2;
const MAX_PART_BYTES = 0xffff;

/** A byte array from any realm (a `Buffer` qualifies); `instanceof` fails across realms. */
export function isBytes(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Decodes canonical, unpadded base64url of exactly `expectedLength` bytes, or returns `undefined`.
 * `Buffer` alone is lenient (it skips junk characters and accepts non-canonical trailing bits), so a
 * document could carry two spellings of one value; the round-trip check keeps the encoding unique.
 */
export function fromBase64Url(text: unknown, expectedLength: number): Buffer | undefined {
  if (typeof text !== 'string' || !BASE64URL_PATTERN.test(text)) return undefined;
  const decoded = Buffer.from(text, 'base64url');
  if (decoded.length !== expectedLength) return undefined;
  return decoded.toString('base64url') === text ? decoded : undefined;
}

/** {@link fromBase64Url} for keyring fields, where a bad encoding means a malformed document. */
export function decodeKeyringField(text: unknown, expectedLength: number): Buffer {
  const decoded = fromBase64Url(text, expectedLength);
  if (!decoded) {
    throw new KeyringError(
      'malformed-keyring',
      'The keyring is malformed: a field is not decodable.',
    );
  }
  return decoded;
}

export function utf8(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

/**
 * Joins parts so that no two different part lists produce the same bytes (each part is preceded by
 * its 2-byte big-endian length). Used wherever several values are bound into one AEAD AAD or one
 * HKDF input.
 */
export function concatLengthPrefixed(parts: readonly Uint8Array[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    if (part.length > MAX_PART_BYTES) {
      throw new KeyringError('invalid-argument', 'A value bound into the AAD exceeds 65535 bytes.');
    }
    const prefix = Buffer.alloc(LENGTH_PREFIX_BYTES);
    prefix.writeUInt16BE(part.length);
    chunks.push(prefix, Buffer.from(part.buffer, part.byteOffset, part.byteLength));
  }
  return Buffer.concat(chunks);
}

/** Zeroes buffers in place. Best effort: it cannot reach copies the JavaScript engine made. */
export function wipe(...buffers: ReadonlyArray<Uint8Array | undefined>): void {
  for (const buffer of buffers) buffer?.fill(0);
}
