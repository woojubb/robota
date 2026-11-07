/**
 * Where the owner link's randomness comes from. Every instance key, ephemeral key and nonce of the
 * spawner exchange and the handshake is drawn here, so the package's known-answer tests can replay a
 * whole exchange or handshake from fixed values. The entry point only ever draws from `randomBytes`;
 * nothing a caller of the package can reach takes other entropy.
 */
import { randomBytes } from 'node:crypto';

import type { Buffer } from 'node:buffer';

export const LINK_SEED_BYTES = 32;
export const LINK_NONCE_BYTES = 32;

export interface ILinkEntropy {
  /** A fresh 32-byte private-key seed. The caller wipes it once the key exists. */
  seed(): Buffer;
  /** A fresh 32-byte nonce. */
  nonce(): Buffer;
}

export const SYSTEM_LINK_ENTROPY: ILinkEntropy = {
  seed: () => randomBytes(LINK_SEED_BYTES),
  nonce: () => randomBytes(LINK_NONCE_BYTES),
};
