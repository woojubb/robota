/**
 * Rendezvous records on the BitTorrent Mainline DHT, as BEP 44 mutable items, straight from this
 * process over UDP — no relay in between.
 *
 * DHT nodes are strangers: they see the one-time key, the rotating salt and ciphertext, and the
 * publisher's address, never who the record is for. Every item a lookup returns is checked here
 * against the key and salt asked for, whatever the nodes claimed to check.
 */
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

import {
  BEP44_MAX_VALUE_BYTES,
  concatBytes,
  signMutableItem,
  verifyMutableItem,
  type IMutableItem,
} from './mesh-records.js';

import type { IRendezvousItemStore } from './mesh-item-store.js';

/** A BEP 44 item as `bittorrent-dht` hands it over. */
interface IDhtGetResult {
  readonly v?: Uint8Array;
  readonly k?: Uint8Array;
  readonly sig?: Uint8Array;
  readonly seq?: number;
  readonly salt?: Uint8Array;
}

/** The slice of a `bittorrent-dht` instance this store drives. */
export interface IMainlineDht {
  put(
    item: {
      readonly k: Buffer;
      readonly salt: Buffer;
      readonly seq: number;
      readonly v: Buffer;
      readonly sig: Buffer;
    },
    callback: (error: Error | null, hash: Buffer, responses?: number) => void,
  ): void;
  get(
    target: Buffer,
    options: { readonly salt: Buffer; readonly cache: false },
    callback: (error: Error | null, result: IDhtGetResult | null) => void,
  ): void;
  on(event: 'error' | 'warning', listener: (error: Error) => void): void;
  destroy(callback?: () => void): void;
}

export interface IMainlineDhtStoreOptions {
  /** Test seam: the DHT client; default a `bittorrent-dht` node on the public bootstrap nodes. */
  readonly createDht?: (verify: TDhtVerify) => IMainlineDht | Promise<IMainlineDht>;
  readonly onError?: (error: Error) => void;
}

type TDhtVerify = (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean;

const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

/** Synchronous Ed25519 verification, as the DHT client asks for it. Never throws. */
export const verifyEd25519Sync: TDhtVerify = (signature, message, publicKey) => {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(concatBytes([ED25519_SPKI_PREFIX, publicKey])),
      format: 'der',
      type: 'spki',
    });
    return verifySignature(null, message, key, signature);
  } catch {
    // allow-fallback: a key or signature that cannot be read verifies nothing
    return false;
  }
};

/** The DHT client package; it ships no types, so it is loaded by name and narrowed here. */
const DHT_MODULE: string = 'bittorrent-dht';

/** A DHT node on the public bootstrap nodes. */
async function defaultDht(verify: TDhtVerify): Promise<IMainlineDht> {
  // eslint-disable-next-line no-restricted-syntax -- truly conditional: only a device that turns the DHT on loads it, and the package is ESM-only
  const module = (await import(DHT_MODULE)) as {
    default: new (options: { verify: TDhtVerify }) => IMainlineDht;
  };
  return new module.default({ verify });
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function aborted(signal: AbortSignal | undefined): Promise<never> | undefined {
  if (signal === undefined) return undefined;
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

/**
 * A Mainline DHT store. The node joins the DHT when the store is created and stays for the life of
 * the store, since joining takes seconds a lookup should not wait on each time.
 */
export async function startMainlineDhtStore(
  options: IMainlineDhtStoreOptions = {},
): Promise<IRendezvousItemStore> {
  const dht = await (options.createDht ?? defaultDht)(verifyEd25519Sync);
  const report = (error: Error): void => options.onError?.(error);
  dht.on('error', report);
  dht.on('warning', report);
  let closed = false;

  return {
    async put(address, value, now, signal) {
      if (closed) throw new Error('DHT store closed');
      if (value.length > BEP44_MAX_VALUE_BYTES) throw new Error('record value exceeds 999 bytes');
      const item = await signMutableItem(address.key, address.salt, Math.floor(now / 1000), value);
      const put = new Promise<void>((resolve, reject) => {
        dht.put(
          {
            k: toBuffer(item.k),
            salt: toBuffer(address.salt),
            seq: item.seq,
            v: toBuffer(item.v),
            sig: toBuffer(item.sig),
          },
          (error, _hash, responses) => {
            if (error !== null) reject(error);
            else if (responses === 0) reject(new Error('no DHT node took the record'));
            else resolve();
          },
        );
      });
      const abort = aborted(signal);
      await (abort === undefined ? put : Promise.race([put, abort]));
    },
    async get(publicKey, salt, signal) {
      if (closed || signal.aborted) return undefined;
      const target = createHash('sha1')
        .update(concatBytes([publicKey, salt]))
        .digest();
      const lookup = new Promise<IDhtGetResult | null>((resolve) => {
        dht.get(target, { salt: toBuffer(salt), cache: false }, (error, result) =>
          resolve(error === null ? result : null),
        );
      });
      try {
        const result = await Promise.race([lookup, aborted(signal)!]);
        if (result?.v === undefined || result.k === undefined || result.sig === undefined) {
          return undefined;
        }
        const item: IMutableItem = {
          k: new Uint8Array(result.k),
          salt,
          seq: result.seq ?? 0,
          v: new Uint8Array(result.v),
          sig: new Uint8Array(result.sig),
        };
        return (await verifyMutableItem(item, publicKey, salt)) ? item.v : undefined;
      } catch {
        // allow-fallback: an aborted or failed lookup found nothing; the next source is tried
        return undefined;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      dht.destroy();
    },
  };
}
