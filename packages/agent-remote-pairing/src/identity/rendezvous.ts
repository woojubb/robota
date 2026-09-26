/**
 * Where two of one user's devices find each other: every value they meet under is derived from
 * their pairwise secret and separated by direction.
 *
 * Nothing is common to all of a user's devices, so a place one pair meets says nothing about any
 * other pair. A device publishes under `dir(self → peer)` and looks up `dir(peer → self)`, so the
 * two directions never overwrite each other, and a value names no device: only the pair can compute
 * it or tell whose it is. Rotating values change every epoch, and a lookup also tries the adjacent
 * epochs, so two clocks that disagree by less than an epoch still meet.
 *
 * Derivation takes the device lists in force and refuses a device they do not name with the same
 * key-agreement key, or revoke: once a device's key rotates or it is revoked, its pairs stop
 * deriving on every device that holds the new lists.
 */

import { ab, concat, encoder, randomBytes, toBase64Url, webcrypto } from '../crypto-primitives.js';
import { derivePairwiseSecret } from './pairwise-secret.js';

import type { IDeviceCertificate } from './certificates.js';
import type { IDeviceRevocationList, IDeviceRoster } from './statements.js';

/** How long a rotating rendezvous value lasts. */
export const RENDEZVOUS_EPOCH_MS = 60 * 60 * 1000;

/** The epoch `now` falls in. */
export function rendezvousEpoch(now: number): number {
  return Math.floor(now / RENDEZVOUS_EPOCH_MS);
}

/** What a rotating tag is for; each purpose yields unrelated values. */
export type TRendezvousTagPurpose = 'mdns' | 'lan-inbox' | 'bep44-salt';

/** `outbound` is `dir(self → peer)`, what this device publishes; `inbound` is the peer's. */
export type TRendezvousDirection = 'outbound' | 'inbound';

export interface IRelayInboxTopics {
  /** Where this device listens for the peer. */
  readonly inbound: string;
  /** Where this device sends to reach the peer. */
  readonly outbound: string;
}

/** The device lists in force: only the devices they name, unrevoked, with those keys, derive. */
export interface IRendezvousLists {
  readonly roster: Pick<IDeviceRoster, 'devices'>;
  readonly revocation: Pick<IDeviceRevocationList, 'revokedDeviceIds'>;
}

export interface IDerivePairRendezvousInput {
  /** This device's X25519 private key: the one its own certificate's `kaKey` names. */
  readonly ownKaPrivateKey: CryptoKey;
  readonly own: IDeviceCertificate;
  readonly peerDeviceId: string;
  readonly lists: IRendezvousLists;
}

/** One device pair's rendezvous, as seen from one of them. */
export interface IPairRendezvous {
  readonly peerDeviceId: string;
  /** A 32-byte tag for `purpose` in one direction at `epoch`. */
  tag(
    purpose: TRendezvousTagPurpose,
    direction: TRendezvousDirection,
    epoch: number,
  ): Promise<Uint8Array>;
  /** The peer's tags for `purpose` at `epoch - 1`, `epoch` and `epoch + 1`. */
  lookupTags(purpose: TRendezvousTagPurpose, epoch: number): Promise<readonly Uint8Array[]>;
  /** The 32-byte seed of the one-time Ed25519 key of one direction at `epoch`. */
  signingSeed(direction: TRendezvousDirection, epoch: number): Promise<Uint8Array>;
  /** Encrypt connection hints under this device's direction at `epoch`. */
  sealRecord(hints: Uint8Array, epoch: number): Promise<Uint8Array>;
  /**
   * Decrypt a record the peer sealed, trying `epoch` and the adjacent ones. `undefined` when it is
   * not the peer's record for this device in any of them.
   */
  openRecord(
    record: Uint8Array,
    epoch: number,
  ): Promise<{ readonly hints: Uint8Array; readonly epoch: number } | undefined>;
  /** The self-hosted relay's inbox topics. They do not rotate: the relay is the user's own. */
  relayInbox(): Promise<IRelayInboxTopics>;
}

const NONCE_BYTES = 12;
const TAG_BYTES = 32;
const RELAY_INBOX_PURPOSE = 'relay-inbox';

function isCurrent(lists: IRendezvousLists, device: IDeviceCertificate): boolean {
  if (lists.revocation.revokedDeviceIds.includes(device.deviceId)) return false;
  const listed = lists.roster.devices.find((d) => d.deviceId === device.deviceId);
  return (
    listed !== undefined &&
    listed.userId === device.userId &&
    listed.kaKey === device.kaKey &&
    listed.kaEpoch === device.kaEpoch
  );
}

/**
 * The rendezvous of this device and `peerDeviceId`. Throws when either is not a current, unrevoked
 * device of the lists, and as {@link derivePairwiseSecret} does.
 */
export async function derivePairRendezvous(
  input: IDerivePairRendezvousInput,
): Promise<IPairRendezvous> {
  const { own, lists, peerDeviceId } = input;
  if (peerDeviceId === own.deviceId) {
    throw new Error('pair rendezvous: a device cannot pair with itself');
  }
  const peer = lists.roster.devices.find((d) => d.deviceId === peerDeviceId);
  if (!isCurrent(lists, own) || peer === undefined || !isCurrent(lists, peer)) {
    throw new Error('pair rendezvous: not a current, unrevoked device of the lists in force');
  }
  const secret = await derivePairwiseSecret({ ownKaPrivateKey: input.ownKaPrivateKey, own, peer });
  const macKey = await webcrypto.subtle.importKey(
    'raw',
    ab(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const hkdfKey = await webcrypto.subtle.importKey('raw', ab(secret), 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  secret.fill(0);

  const dir = (direction: TRendezvousDirection): readonly [string, string] =>
    direction === 'outbound' ? [own.deviceId, peerDeviceId] : [peerDeviceId, own.deviceId];
  const label = (parts: readonly (string | number | null)[]): Uint8Array =>
    encoder.encode(JSON.stringify(parts));
  const mac = async (parts: readonly (string | number | null)[]): Promise<Uint8Array> =>
    new Uint8Array(await webcrypto.subtle.sign('HMAC', macKey, ab(label(parts))));
  const hkdf = (info: Uint8Array) =>
    ({ name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(0), info: ab(info) }) as const;
  const recordKey = (direction: TRendezvousDirection, epoch: number): Promise<CryptoKey> =>
    webcrypto.subtle.deriveKey(
      hkdf(label(['enc', ...dir(direction), epoch])),
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  const recordData = (direction: TRendezvousDirection, epoch: number): Uint8Array =>
    label(['record', ...dir(direction), epoch]);
  const tag = async (
    purpose: TRendezvousTagPurpose,
    direction: TRendezvousDirection,
    epoch: number,
  ): Promise<Uint8Array> => (await mac([purpose, ...dir(direction), epoch])).slice(0, TAG_BYTES);

  return {
    peerDeviceId,
    tag,
    lookupTags: (purpose, epoch) =>
      Promise.all([epoch - 1, epoch, epoch + 1].map((e) => tag(purpose, 'inbound', e))),
    signingSeed: async (direction, epoch) =>
      new Uint8Array(
        await webcrypto.subtle.deriveBits(
          hkdf(label(['sign', ...dir(direction), epoch])),
          hkdfKey,
          256,
        ),
      ),
    sealRecord: async (hints, epoch) => {
      const nonce = randomBytes(NONCE_BYTES);
      const sealed = await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv: ab(nonce), additionalData: ab(recordData('outbound', epoch)) },
        await recordKey('outbound', epoch),
        ab(hints),
      );
      return concat([nonce, new Uint8Array(sealed)]);
    },
    openRecord: async (record, epoch) => {
      if (record.length <= NONCE_BYTES) return undefined;
      const nonce = record.slice(0, NONCE_BYTES);
      const body = record.slice(NONCE_BYTES);
      for (const e of [epoch, epoch - 1, epoch + 1]) {
        try {
          const hints = await webcrypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ab(nonce), additionalData: ab(recordData('inbound', e)) },
            await recordKey('inbound', e),
            ab(body),
          );
          return { hints: new Uint8Array(hints), epoch: e };
        } catch {
          // allow-fallback: not this epoch's record; the next epoch, or none, is tried
        }
      }
      return undefined;
    },
    relayInbox: async () => ({
      inbound: toBase64Url(await mac([RELAY_INBOX_PURPOSE, ...dir('inbound'), null])),
      outbound: toBase64Url(await mac([RELAY_INBOX_PURPOSE, ...dir('outbound'), null])),
    }),
  };
}
