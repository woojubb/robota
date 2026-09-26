import { beforeAll, describe, expect, it } from 'vitest';

import {
  certifyDevice,
  certifySigningKey,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  generateSigningKeyPair,
  type IDeviceCertificate,
  type ISigningKey,
} from '../identity/certificates.js';
import { deriveMasterKey } from '../identity/master-key.js';
import {
  RENDEZVOUS_EPOCH_MS,
  derivePairRendezvous,
  rendezvousEpoch,
  type IPairRendezvous,
  type IRendezvousLists,
} from '../identity/rendezvous.js';
import { issueDeviceRevocationList, issueDeviceRoster } from '../identity/statements.js';

const NOW = 1_800_000_000_000;
const EPOCH = rendezvousEpoch(NOW);
const PHRASE =
  'hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length';

interface IDevice {
  readonly cert: IDeviceCertificate;
  readonly sign: CryptoKeyPair;
  readonly ka: CryptoKeyPair;
}

let signingKey: ISigningKey;
let a: IDevice;
let b: IDevice;
let c: IDevice;
let lists: IRendezvousLists;

async function device(name: string, sign?: CryptoKeyPair, kaEpoch = 0): Promise<IDevice> {
  const signPair = sign ?? (await generateDeviceSignKeyPair(false));
  const ka = await generateDeviceKeyAgreementKeyPair(false);
  const cert = await certifyDevice({
    signingKey,
    signPublicKey: signPair.publicKey,
    kaPublicKey: ka.publicKey,
    kaEpoch,
    name,
    capabilities: ['message'],
    issuedAt: NOW,
  });
  return { cert, sign: signPair, ka };
}

async function listsOf(
  devices: readonly IDevice[],
  revoked: readonly IDevice[] = [],
  seq = 1,
): Promise<IRendezvousLists> {
  return {
    roster: await issueDeviceRoster({
      signingKey,
      seq,
      issuedAt: NOW,
      devices: devices.map((d) => d.cert),
    }),
    revocation: await issueDeviceRevocationList({
      signingKey,
      seq,
      issuedAt: NOW,
      revokedDeviceIds: revoked.map((d) => d.cert.deviceId),
    }),
  };
}

beforeAll(async () => {
  const master = await deriveMasterKey(PHRASE);
  const pair = await generateSigningKeyPair({ extractable: false });
  const certificate = await certifySigningKey({
    masterPrivateKey: master.keyPair.privateKey,
    userId: master.userId,
    signingPublicKey: pair.publicKey,
    issuedAt: NOW,
  });
  signingKey = { certificate, privateKey: pair.privateKey };
  a = await device('a');
  b = await device('b');
  c = await device('c');
  lists = await listsOf([a, b, c]);
});

function pair(own: IDevice, peer: IDevice, current = lists): Promise<IPairRendezvous> {
  return derivePairRendezvous({
    ownKaPrivateKey: own.ka.privateKey,
    own: own.cert,
    peerDeviceId: peer.cert.deviceId,
    lists: current,
  });
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('pairwise rendezvous', () => {
  it('epochs are one hour long', () => {
    expect(RENDEZVOUS_EPOCH_MS).toBe(60 * 60 * 1000);
    expect(rendezvousEpoch(NOW + RENDEZVOUS_EPOCH_MS)).toBe(EPOCH + 1);
  });

  it('what one device publishes is what its peer looks up, and the two directions never collide', async () => {
    const ab = await pair(a, b);
    const ba = await pair(b, a);
    for (const purpose of ['mdns', 'lan-inbox', 'bep44-salt'] as const) {
      const aPublishes = hex(await ab.tag(purpose, 'outbound', EPOCH));
      const bPublishes = hex(await ba.tag(purpose, 'outbound', EPOCH));
      expect(aPublishes).not.toBe(bPublishes);
      expect(hex(await ba.tag(purpose, 'inbound', EPOCH))).toBe(aPublishes);
      expect(hex(await ab.tag(purpose, 'inbound', EPOCH))).toBe(bPublishes);
    }
    // The purposes are separate too.
    expect(hex(await ab.tag('mdns', 'outbound', EPOCH))).not.toBe(
      hex(await ab.tag('bep44-salt', 'outbound', EPOCH)),
    );
    expect(hex(await ab.signingSeed('outbound', EPOCH))).toBe(
      hex(await ba.signingSeed('inbound', EPOCH)),
    );
    expect(hex(await ab.signingSeed('outbound', EPOCH))).not.toBe(
      hex(await ab.signingSeed('inbound', EPOCH)),
    );
    expect(await ab.signingSeed('outbound', EPOCH)).toHaveLength(32);
  });

  it('rotates every epoch, and a lookup covers the adjacent epochs', async () => {
    const ab = await pair(a, b);
    const ba = await pair(b, a);
    const published = new Set<string>();
    for (const e of [EPOCH - 1, EPOCH, EPOCH + 1]) {
      published.add(hex(await ab.tag('mdns', 'outbound', e)));
    }
    expect(published.size).toBe(3);
    const lookedUp = (await ba.lookupTags('mdns', EPOCH)).map(hex);
    expect(new Set(lookedUp)).toEqual(published);
    // Two epochs away is not looked up.
    expect(lookedUp).not.toContain(hex(await ab.tag('mdns', 'outbound', EPOCH + 2)));
  });

  it('a sealed record opens only for the peer, only in its direction, within one epoch either way', async () => {
    const ab = await pair(a, b);
    const ba = await pair(b, a);
    const hints = new TextEncoder().encode('{"port":4242}');
    const record = await ab.sealRecord(hints, EPOCH);
    expect(hex(record)).not.toContain(hex(hints));

    for (const lookup of [EPOCH - 1, EPOCH, EPOCH + 1]) {
      const opened = await ba.openRecord(record, lookup);
      expect(opened?.epoch).toBe(EPOCH);
      expect(new TextDecoder().decode(opened?.hints)).toBe('{"port":4242}');
    }
    await expect(ba.openRecord(record, EPOCH + 2)).resolves.toBeUndefined();
    // Its own record is not something a device reads as its peer's.
    await expect(ab.openRecord(record, EPOCH)).resolves.toBeUndefined();
    // Another pair cannot open it.
    await expect((await pair(c, a)).openRecord(record, EPOCH)).resolves.toBeUndefined();
    const tampered = new Uint8Array(record);
    tampered[tampered.length - 1] ^= 1;
    await expect(ba.openRecord(tampered, EPOCH)).resolves.toBeUndefined();
    await expect(ba.openRecord(new Uint8Array(4), EPOCH)).resolves.toBeUndefined();
  });

  it('each record purpose has its own one-time key and sealing key, and the purposes never open each other', async () => {
    const ab = await pair(a, b);
    const ba = await pair(b, a);
    const seeds = new Set<string>();
    for (const purpose of ['hints', 'revocation', 'signal'] as const) {
      const seed = hex(await ab.signingSeed('outbound', EPOCH, purpose));
      expect(seed).toBe(hex(await ba.signingSeed('inbound', EPOCH, purpose)));
      seeds.add(seed);
    }
    expect(seeds.size).toBe(3);
    // The connection-hints key is the one the pair always derived.
    expect(hex(await ab.signingSeed('outbound', EPOCH, 'hints'))).toBe(
      hex(await ab.signingSeed('outbound', EPOCH)),
    );

    const data = new TextEncoder().encode('payload');
    const signal = await ab.sealRecord(data, EPOCH, 'signal');
    expect(new TextDecoder().decode((await ba.openRecord(signal, EPOCH, 'signal'))?.hints)).toBe(
      'payload',
    );
    await expect(ba.openRecord(signal, EPOCH)).resolves.toBeUndefined();
    await expect(ba.openRecord(signal, EPOCH, 'revocation')).resolves.toBeUndefined();
    await expect(
      ba.openRecord(await ab.sealRecord(data, EPOCH), EPOCH, 'signal'),
    ).resolves.toBeUndefined();

    for (const purpose of ['bep44-revocation-salt', 'nostr-kind'] as const) {
      expect(hex(await ab.tag(purpose, 'outbound', EPOCH))).toBe(
        hex(await ba.tag(purpose, 'inbound', EPOCH)),
      );
      expect(hex(await ab.tag(purpose, 'outbound', EPOCH))).not.toBe(
        hex(await ab.tag('bep44-salt', 'outbound', EPOCH)),
      );
    }
  });

  it('relay inbox topics: one per direction, opaque, and pairwise', async () => {
    const ab = await (await pair(a, b)).relayInbox();
    const ba = await (await pair(b, a)).relayInbox();
    const ac = await (await pair(a, c)).relayInbox();
    expect(ab.outbound).toBe(ba.inbound);
    expect(ab.inbound).toBe(ba.outbound);
    expect(ab.inbound).not.toBe(ab.outbound);
    expect(new Set([ab.inbound, ab.outbound, ac.inbound, ac.outbound]).size).toBe(4);
    for (const topic of [ab.inbound, ab.outbound]) {
      expect(topic).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(topic).not.toContain(a.cert.deviceId.slice(0, 8));
      expect(topic).not.toContain(b.cert.deviceId.slice(0, 8));
    }
  });

  it("a revoked device's pairs stop deriving, on both sides", async () => {
    const revoking = await listsOf([a, b, c], [b], 2);
    await expect(pair(a, b, revoking)).rejects.toThrow(/not a current, unrevoked device/);
    await expect(pair(b, a, revoking)).rejects.toThrow(/not a current, unrevoked device/);
    // The other pairs are untouched.
    await expect(pair(a, c, revoking)).resolves.toBeDefined();
  });

  it("a rotated key-agreement key stops deriving the old key's pairs; the new key's are unrelated", async () => {
    const rotated = await device('b', b.sign, 1);
    expect(rotated.cert.deviceId).toBe(b.cert.deviceId);
    const after = await listsOf([a, rotated, c], [], 2);
    const before = await (await pair(a, b)).tag('mdns', 'outbound', EPOCH);

    // The old key derives nothing any more.
    await expect(pair(b, a, after)).rejects.toThrow(/not a current, unrevoked device/);
    // a derives only with b's current key, and gets a value unrelated to the old one.
    const current = await pair(a, rotated, after);
    const tag = hex(await current.tag('mdns', 'outbound', EPOCH));
    expect(tag).not.toBe(hex(before));
    expect(tag).toBe(hex(await (await pair(rotated, a, after)).tag('mdns', 'inbound', EPOCH)));
  });

  it('a device outside the roster, or the device itself, derives nothing', async () => {
    const stranger = await device('stranger');
    await expect(pair(a, stranger)).rejects.toThrow(/not a current, unrevoked device/);
    await expect(pair(stranger, a)).rejects.toThrow(/not a current, unrevoked device/);
    await expect(pair(a, a)).rejects.toThrow(/itself/);
  });
});
