/**
 * One user's identity with three devices, for device mesh tests: `low` and `high` are ordered by
 * device id, so `low` is the offerer of their pair; `third` is a third rostered device.
 */
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
  type IDeviceCertificate,
  type IDeviceHandshakeIdentity,
  type IDeviceRevocationList,
  type ISessionDescriptor,
  type ISigningKey,
  type TDeviceCapability,
} from '@robota-sdk/agent-remote-pairing';

export const PHRASE =
  'hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length';

export const ALL_CAPABILITIES: readonly TDeviceCapability[] = [
  'delegate',
  'drive',
  'handoff',
  'message',
  'observe',
  'presence',
];

export interface IMeshTestDevice {
  readonly cert: IDeviceCertificate;
  readonly sign: CryptoKeyPair;
  readonly ka: CryptoKeyPair;
  readonly session: ISessionDescriptor;
}

export interface IMeshTestWorld {
  readonly signingKey: ISigningKey;
  readonly masterPublicKey: string;
  readonly low: IMeshTestDevice;
  readonly high: IMeshTestDevice;
  readonly third: IMeshTestDevice;
  identity(
    device: IMeshTestDevice,
    over?: Partial<IDeviceHandshakeIdentity>,
  ): IDeviceHandshakeIdentity;
  /** A newer revocation list revoking `device`. */
  revoking(device: IMeshTestDevice): Promise<IDeviceRevocationList>;
}

async function makeDevice(
  signingKey: ISigningKey,
  name: string,
  now: number,
): Promise<IMeshTestDevice> {
  const sign = await generateDeviceSignKeyPair(false);
  const ka = await generateDeviceKeyAgreementKeyPair(false);
  const cert = await certifyDevice({
    signingKey,
    signPublicKey: sign.publicKey,
    kaPublicKey: ka.publicKey,
    kaEpoch: 0,
    name,
    capabilities: ALL_CAPABILITIES,
    issuedAt: now,
  });
  const session = await signSessionDescriptor({
    signPrivateKey: sign.privateKey,
    deviceId: cert.deviceId,
    sessionId: `c2Vzc2lvbi${name}`,
    startedAt: now,
  });
  return { cert, sign, ka, session };
}

export async function buildMeshWorld(now = Date.now()): Promise<IMeshTestWorld> {
  const master = await deriveMasterKey(PHRASE);
  const pair = await generateSigningKeyPair({ extractable: false });
  const certificate = await certifySigningKey({
    masterPrivateKey: master.keyPair.privateKey,
    userId: master.userId,
    signingPublicKey: pair.publicKey,
    issuedAt: now,
  });
  const signingKey: ISigningKey = { certificate, privateKey: pair.privateKey };
  const made = [
    await makeDevice(signingKey, 'one', now),
    await makeDevice(signingKey, 'two', now),
    await makeDevice(signingKey, 'three', now),
  ];
  const [low, high] = [made[0]!, made[1]!].sort((x, y) =>
    x.cert.deviceId < y.cert.deviceId ? -1 : 1,
  ) as [IMeshTestDevice, IMeshTestDevice];
  const third = made[2]!;
  const roster = await issueDeviceRoster({
    signingKey,
    seq: 10,
    issuedAt: now,
    devices: made.map((d) => d.cert),
  });
  const revocation = await issueDeviceRevocationList({
    signingKey,
    seq: 10,
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
  return {
    signingKey,
    masterPublicKey: master.publicKey,
    low,
    high,
    third,
    identity: (device, over = {}) => ({
      masterPublicKey: master.publicKey,
      signingKeyCertificate: certificate,
      deviceCertificate: device.cert,
      signPrivateKey: device.sign.privateKey,
      kaPrivateKey: device.ka.privateKey,
      roster,
      revocation,
      signingKeyRevocation,
      marks: {},
      ...over,
    }),
    revoking: (device) =>
      issueDeviceRevocationList({
        signingKey,
        seq: 11,
        issuedAt: now,
        revokedDeviceIds: [device.cert.deviceId],
      }),
  };
}
