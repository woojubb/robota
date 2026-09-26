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
import { deriveRelayInboxTopics } from '../identity/relay-inbox.js';

const NOW = 1_800_000_000_000;
const PHRASE =
  'hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length';

interface IDevice {
  readonly cert: IDeviceCertificate;
  readonly ka: CryptoKeyPair;
}

let a: IDevice;
let b: IDevice;
let c: IDevice;

async function device(signingKey: ISigningKey, name: string): Promise<IDevice> {
  const sign = await generateDeviceSignKeyPair(false);
  const ka = await generateDeviceKeyAgreementKeyPair(false);
  const cert = await certifyDevice({
    signingKey,
    signPublicKey: sign.publicKey,
    kaPublicKey: ka.publicKey,
    kaEpoch: 0,
    name,
    capabilities: ['message'],
    issuedAt: NOW,
  });
  return { cert, ka };
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
  const signingKey = { certificate, privateKey: pair.privateKey };
  a = await device(signingKey, 'a');
  b = await device(signingKey, 'b');
  c = await device(signingKey, 'c');
});

function topics(own: IDevice, peer: IDevice) {
  return deriveRelayInboxTopics({
    ownKaPrivateKey: own.ka.privateKey,
    own: own.cert,
    peer: peer.cert,
  });
}

describe('relay inbox topics', () => {
  it('what one device sends to is what its peer listens on, in each direction', async () => {
    const ab = await topics(a, b);
    const ba = await topics(b, a);
    expect(ab.outbound).toBe(ba.inbound);
    expect(ab.inbound).toBe(ba.outbound);
  });

  it('separates the two directions', async () => {
    const ab = await topics(a, b);
    expect(ab.inbound).not.toBe(ab.outbound);
  });

  it('is pairwise: another pair shares no topic', async () => {
    const ab = await topics(a, b);
    const ac = await topics(a, c);
    expect(new Set([ab.inbound, ab.outbound, ac.inbound, ac.outbound]).size).toBe(4);
  });

  it('is opaque: no device id appears in a topic, and topics are 256-bit base64url', async () => {
    const ab = await topics(a, b);
    for (const topic of [ab.inbound, ab.outbound]) {
      expect(topic).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(topic).not.toContain(a.cert.deviceId.slice(0, 8));
      expect(topic).not.toContain(b.cert.deviceId.slice(0, 8));
    }
  });
});
