import { createHash } from 'node:crypto';

import { isBytes } from './bytes.js';
import { KeyringError } from './errors.js';
import { KEY_BYTES } from './kdf.js';

const FINGERPRINT_BYTES = 10;
const GROUP_HEX_CHARS = 4;

/**
 * A short string two people can read to each other to confirm they hold the same public key: the
 * first 10 bytes of SHA-256 of the raw 32-byte key, as upper-case hex in groups of four
 * (`A1B2-C3D4-E5F6-0718-293A`). 80 bits is for a human comparing out loud or on screen; it is a
 * check against accidents and casual swaps, not a collision-resistant identifier.
 */
export function fingerprint(publicKey: Uint8Array): string {
  if (!isBytes(publicKey) || publicKey.length !== KEY_BYTES) {
    throw new KeyringError(
      'invalid-argument',
      'A public key must be a Uint8Array of exactly 32 bytes.',
    );
  }
  const hex = createHash('sha256')
    .update(publicKey)
    .digest('hex')
    .slice(0, FINGERPRINT_BYTES * 2);
  const groups: string[] = [];
  for (let index = 0; index < hex.length; index += GROUP_HEX_CHARS) {
    groups.push(hex.slice(index, index + GROUP_HEX_CHARS).toUpperCase());
  }
  return groups.join('-');
}
