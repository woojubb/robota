import {
  certifyDevice,
  certifySigningKey,
  deriveMasterKey,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  generateSigningKeyPair,
  issueDeviceRevocationList,
  issueDeviceRoster,
  issueSigningKeyRevocation,
  signSessionDescriptor,
  type IDeviceHandshakeIdentity,
  type ISessionDescriptor,
  type ISigningKey,
} from '@robota-sdk/agent-remote-pairing';
import { DeviceMeshNode, WsMeshRelayClient } from '@robota-sdk/agent-transport-webrtc';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import { startSignalingServer, type ISignalingServerHandle } from '../server.js';

/**
 * Two of one user's devices find each other through the real relay's `presence` / `message`
 * frames, connect over WebRTC, admit each other with the device handshake, and exchange a message.
 * The relay sees only opaque inbox topics and signaling blobs.
 */

const PHRASE =
  'hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length';

async function twoDevices(): Promise<[IDeviceHandshakeIdentity, ISessionDescriptor][]> {
  const now = Date.now();
  const master = await deriveMasterKey(PHRASE);
  const pair = await generateSigningKeyPair({ extractable: false });
  const certificate = await certifySigningKey({
    masterPrivateKey: master.keyPair.privateKey,
    userId: master.userId,
    signingPublicKey: pair.publicKey,
    issuedAt: now,
  });
  const signingKey: ISigningKey = { certificate, privateKey: pair.privateKey };
  const devices = await Promise.all(
    ['laptop', 'desktop'].map(async (name) => {
      const sign = await generateDeviceSignKeyPair(false);
      const ka = await generateDeviceKeyAgreementKeyPair(false);
      const cert = await certifyDevice({
        signingKey,
        signPublicKey: sign.publicKey,
        kaPublicKey: ka.publicKey,
        kaEpoch: 0,
        name,
        capabilities: ['message', 'presence'],
        issuedAt: now,
      });
      const session = await signSessionDescriptor({
        signPrivateKey: sign.privateKey,
        deviceId: cert.deviceId,
        sessionId: `c2Vzc2lvbi${name}`,
        startedAt: now,
      });
      return { cert, sign, ka, session };
    }),
  );
  const roster = await issueDeviceRoster({
    signingKey,
    seq: 1,
    issuedAt: now,
    devices: devices.map((d) => d.cert),
  });
  const revocation = await issueDeviceRevocationList({
    signingKey,
    seq: 1,
    issuedAt: now,
    revokedDeviceIds: [],
  });
  const signingKeyRevocation = await issueSigningKeyRevocation({
    masterPrivateKey: master.keyPair.privateKey,
    userId: master.userId,
    seq: 1,
    issuedAt: now,
    revokedSigningKeyIds: [],
  });
  return devices.map((d) => [
    {
      masterPublicKey: master.publicKey,
      signingKeyCertificate: certificate,
      deviceCertificate: d.cert,
      signPrivateKey: d.sign.privateKey,
      kaPrivateKey: d.ka.privateKey,
      roster,
      revocation,
      signingKeyRevocation,
      marks: {},
    },
    d.session,
  ]);
}

// The WebRTC library's own warnings, so a connection that fails in CI says why at its layer too.
(
  createRequire(import.meta.url)('node-datachannel') as {
    initLogger(level: string, callback: (level: string, message: string) => void): void;
  }
).initLogger('Warning', (level, message) => {
  process.stderr.write(`[libdatachannel ${level}] ${message}\n`);
});

let server: ISignalingServerHandle | undefined;
const cleanup: (() => void)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0)) step();
  await server?.close();
  server = undefined;
});

describe('device mesh over the real signaling relay', () => {
  it('two devices connect, are admitted by the device handshake, and deliver a message', async () => {
    server = await startSignalingServer();
    const url = `ws://127.0.0.1:${server.port}`;
    const [[laptop, laptopSession], [desktop, desktopSession]] = await twoDevices();
    const errors: Error[] = [];
    const node = (
      identity: IDeviceHandshakeIdentity,
      session: ISessionDescriptor,
    ): DeviceMeshNode => {
      const relay = new WsMeshRelayClient({ url, onError: (error) => errors.push(error) });
      const created = new DeviceMeshNode({
        identity,
        sessionDescriptor: session,
        localPolicy: ['message'],
        relay,
      });
      cleanup.push(() => {
        created.stop();
        relay.close();
      });
      return created;
    };
    const a = node(laptop!, laptopSession!);
    const b = node(desktop!, desktopSession!);
    await a.start();
    await b.start();

    const [atA, atB] = await Promise.all([
      a.connect(desktop!.deviceCertificate.deviceId),
      b.connect(laptop!.deviceCertificate.deviceId),
    ]);
    const received = new Promise<string>((resolve) => atB.onMessage(resolve));
    atA.send('over the relay-established channel');

    await expect(received).resolves.toBe('over the relay-established channel');
    expect(atA.admission.capabilities).toEqual(['message']);
    expect(server.relay.presenceTopicCount).toBe(2);
    // Nothing the relay refused along the way (the first announcement may find the peer absent).
    expect(errors).toEqual([]);
  }, 40_000);
});
