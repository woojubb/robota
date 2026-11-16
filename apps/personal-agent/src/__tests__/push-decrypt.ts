/**
 * What a browser does with a push message, written for the tests: decrypt the `aes128gcm` body (RFC 8188)
 * that a Web Push message uses (RFC 8291) with the browser's own keys. It is written from the RFCs and
 * checked against the RFC's own example before it is trusted to judge what the agent sends; it shares
 * no code with the library that builds the message.
 */
import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';

export interface IBrowserKeys {
  /** The browser's private key (32 bytes). */
  readonly private: Buffer;
  /** The browser's public key (65 bytes): `keys.p256dh` of its subscription. */
  readonly public: Buffer;
  /** The 16-byte authentication secret: `keys.auth` of its subscription. */
  readonly auth: Buffer;
}

const hkdf = (salt: Buffer, secret: Buffer, info: Buffer, length: number): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, salt, info, length));

export interface IDecrypted {
  readonly plaintext: Buffer;
  readonly salt: Buffer;
  readonly recordSize: number;
  /** The sender's public key, which the message carries as its key id. */
  readonly senderKey: Buffer;
}

/** The body of one message, as its receiver reads it; throws when it is not what the keys can open. */
export function decryptPush(body: Buffer, keys: IBrowserKeys): IDecrypted {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body[20]!;
  const senderKey = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  if (record.length > recordSize) throw new Error('more than one record');
  const agreement = createECDH('prime256v1');
  agreement.setPrivateKey(keys.private);
  const shared = agreement.computeSecret(senderKey);
  const secret = hkdf(
    keys.auth,
    shared,
    Buffer.concat([Buffer.from('WebPush: info\0'), keys.public, senderKey]),
    32,
  );
  const contentKey = hkdf(salt, secret, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, secret, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  // The data ends at the last delimiter: 0x02 closes the last record, and zeros may follow it.
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end -= 1;
  if (padded[end - 1] !== 0x02) throw new Error('no closing delimiter');
  return { plaintext: padded.subarray(0, end - 1), salt, recordSize, senderKey };
}

/** A browser's keys made fresh, as `PushSubscription` has them. */
export function newBrowserKeys(): IBrowserKeys {
  const pair = createECDH('prime256v1');
  pair.generateKeys();
  return {
    private: pair.getPrivateKey(),
    public: pair.getPublicKey(),
    auth: Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))),
  };
}

/** The subscription a browser holding these keys would give, for a push service at `endpoint`. */
export const subscriptionOf = (
  endpoint: string,
  keys: IBrowserKeys,
): { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } } => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: keys.public.toString('base64url'), auth: keys.auth.toString('base64url') },
});
