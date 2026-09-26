/**
 * Where two of one user's devices meet on a signaling relay: one inbox topic per direction, derived
 * from their pairwise secret.
 *
 * The relay learns only opaque topics. Nobody but the pair can compute them, so the relay cannot
 * link a topic to a device or to the user, and a third party cannot address or listen on the pair's
 * inboxes. The two directions are separate topics so a device never receives its own messages back
 * and the recipient knows which peer a message is for without the message naming anyone.
 */

import { ab, encoder, toBase64Url, webcrypto } from '../crypto-primitives.js';
import { derivePairwiseSecret, type IDerivePairwiseSecretInput } from './pairwise-secret.js';

/** The HMAC label of an inbox topic under the pairwise secret. */
export const RELAY_INBOX_LABEL = 'robota/relay-inbox/v1';

export interface IRelayInboxTopics {
  /** Where this device listens for the peer. */
  readonly inbound: string;
  /** Where this device sends to reach the peer. */
  readonly outbound: string;
}

async function inboxTopic(key: CryptoKey, recipient: string, sender: string): Promise<string> {
  const mac = await webcrypto.subtle.sign(
    'HMAC',
    key,
    ab(encoder.encode(JSON.stringify([RELAY_INBOX_LABEL, recipient, sender]))),
  );
  return toBase64Url(new Uint8Array(mac));
}

/** Both inbox topics of a device pair, as seen from `own`. Throws as {@link derivePairwiseSecret} does. */
export async function deriveRelayInboxTopics(
  input: IDerivePairwiseSecretInput,
): Promise<IRelayInboxTopics> {
  const secret = await derivePairwiseSecret(input);
  const key = await webcrypto.subtle.importKey(
    'raw',
    ab(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const own = input.own.deviceId;
  const peer = input.peer.deviceId;
  return {
    inbound: await inboxTopic(key, own, peer),
    outbound: await inboxTopic(key, peer, own),
  };
}
