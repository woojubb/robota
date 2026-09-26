/**
 * The secret two of one user's devices share and nobody else can compute: an X25519 agreement
 * between their certified key-agreement keys, expanded by HKDF.
 *
 * It is pairwise by construction, so no secret is common to all of a user's devices: learning one
 * pair's value says nothing about any other pair. The user id salts it and both key-agreement
 * epochs are in its info, so rotating either key yields an unrelated value. Both sides order the
 * pair by device id, which makes the value symmetric without either side choosing.
 */

import { ab, encoder, webcrypto } from '../crypto-primitives.js';
import { decodeBase64Url } from './encoding.js';
import type { IDeviceCertificate } from './certificates.js';

/** The HKDF info label. Rendezvous keys are derived from the output under their own labels. */
export const PAIRWISE_SECRET_LABEL = 'robota/rdv/v1';

const SECRET_BITS = 256;

type TPairwiseParty = Pick<IDeviceCertificate, 'userId' | 'deviceId' | 'kaKey' | 'kaEpoch'>;

export interface IDerivePairwiseSecretInput {
  /** This device's X25519 private key: the one its own certificate's `kaKey` names. */
  readonly ownKaPrivateKey: CryptoKey;
  readonly own: TPairwiseParty;
  readonly peer: TPairwiseParty;
}

/** `S_AB`, 32 bytes. Throws when the two devices are one device or belong to different users. */
export async function derivePairwiseSecret(input: IDerivePairwiseSecretInput): Promise<Uint8Array> {
  const { own, peer } = input;
  if (own.userId !== peer.userId)
    throw new Error('pairwise secret: the devices belong to different users');
  if (own.deviceId === peer.deviceId)
    throw new Error('pairwise secret: a device cannot pair with itself');
  const peerKey = await webcrypto.subtle.importKey(
    'spki',
    ab(decodeBase64Url(peer.kaKey)),
    { name: 'X25519' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await webcrypto.subtle.deriveBits(
      { name: 'X25519', public: peerKey } as EcdhKeyDeriveParams,
      input.ownKaPrivateKey,
      SECRET_BITS,
    ),
  );
  // A small-order peer key yields the all-zero value on some stacks; it is a refusal everywhere.
  if (shared.every((byte) => byte === 0)) throw new Error('pairwise secret: degenerate agreement');
  const [low, high] = own.deviceId < peer.deviceId ? [own, peer] : [peer, own];
  const info = encoder.encode(
    JSON.stringify([PAIRWISE_SECRET_LABEL, low.deviceId, low.kaEpoch, high.deviceId, high.kaEpoch]),
  );
  const ikm = await webcrypto.subtle.importKey('raw', ab(shared), 'HKDF', false, ['deriveBits']);
  const secret = await webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: ab(decodeBase64Url(own.userId)), info: ab(info) },
    ikm,
    SECRET_BITS,
  );
  return new Uint8Array(secret);
}
