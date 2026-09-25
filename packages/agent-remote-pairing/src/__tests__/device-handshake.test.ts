import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  certifyDevice,
  certifySigningKey,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  generateSigningKeyPair,
  type IDeviceCertificate,
  type ISigningKey,
  type TDeviceCapability,
} from '../identity/certificates.js';
import { HOUR_MS, IDENTITY_PURPOSES, canonicalBytes, signCanonical } from '../identity/encoding.js';
import { deriveMasterKey, type IMasterKey } from '../identity/master-key.js';
import {
  REVOCATION_LIST_VALIDITY_MS,
  issueDeviceRevocationList,
  issueDeviceRoster,
  issueSigningKeyRevocation,
  signSessionDescriptor,
  type IDeviceRevocationList,
  type IDeviceRoster,
  type ISessionDescriptor,
  type ISigningKeyRevocation,
} from '../identity/statements.js';
import { derivePairwiseSecret } from '../identity/pairwise-secret.js';
import {
  FRESHNESS_LOOKUP_MS,
  REMOTE_ADMISSION_GRACE_MS,
  DeviceHandshakeError,
  startDeviceHandshake,
  type IDeviceHandshakeIdentity,
  type IDeviceHandshakeOptions,
  type IDeviceHandshakeResult,
  type IListUpdate,
} from '../identity/device-handshake.js';
import {
  handshakeTranscriptFields,
  type TDeviceHandshakeFrame,
} from '../identity/device-handshake-frames.js';

const NOW = 1_800_000_000_000;
const PHRASE =
  'hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length';
const OTHER_PHRASE =
  'all hour make first leader extend hole alien behind guard gospel lava path output census museum junior mass reopen famous sing advance salt reform';

const FP_A = 'sha-256 AA:AA:AA:AA';
const FP_B = 'sha-256 BB:BB:BB:BB';
const FP_R1 = 'sha-256 C1:C1:C1:C1';
const FP_R2 = 'sha-256 C2:C2:C2:C2';
const ALL: readonly TDeviceCapability[] = [
  'delegate',
  'drive',
  'handoff',
  'message',
  'observe',
  'presence',
];

interface IDevice {
  readonly name: string;
  readonly cert: IDeviceCertificate;
  readonly sign: CryptoKeyPair;
  readonly ka: CryptoKeyPair;
  readonly session: ISessionDescriptor;
}

interface IWorld {
  readonly master: IMasterKey;
  readonly signingKey: ISigningKey;
  readonly devices: Readonly<Record<'a' | 'b' | 'c' | 'd', IDevice>>;
  /** a, b, c — d is certified but never rostered. */
  readonly roster: IDeviceRoster;
  readonly revocation: IDeviceRevocationList;
  /** seq 8: revokes c. */
  readonly revokedC: IDeviceRevocationList;
  readonly signingKeyRevocation: ISigningKeyRevocation;
}

async function makeDevice(
  signingKey: ISigningKey,
  name: string,
  capabilities: readonly TDeviceCapability[],
): Promise<IDevice> {
  const sign = await generateDeviceSignKeyPair(false);
  const ka = await generateDeviceKeyAgreementKeyPair(false);
  const cert = await certifyDevice({
    signingKey,
    signPublicKey: sign.publicKey,
    kaPublicKey: ka.publicKey,
    kaEpoch: 1,
    name,
    capabilities,
    issuedAt: NOW,
  });
  const session = await signSessionDescriptor({
    signPrivateKey: sign.privateKey,
    deviceId: cert.deviceId,
    sessionId: `c2Vzc2lvbi0${name}`,
    workspaceClaim: `d29ya3NwYWNl${name}`,
    startedAt: NOW,
    // Outlives every clock the freshness tests set, so only the lists age.
    expiresAt: NOW + 30 * 24 * HOUR_MS,
  });
  return { name, cert, sign, ka, session };
}

async function buildWorld(phrase: string): Promise<IWorld> {
  const master = await deriveMasterKey(phrase);
  const signing = await generateSigningKeyPair({ extractable: false });
  const certificate = await certifySigningKey({
    masterPrivateKey: master.keyPair.privateKey,
    userId: master.userId,
    signingPublicKey: signing.publicKey,
    issuedAt: NOW,
  });
  const signingKey: ISigningKey = { certificate, privateKey: signing.privateKey };
  const a = await makeDevice(signingKey, 'a', ['handoff', 'message', 'presence']);
  const b = await makeDevice(signingKey, 'b', ['drive', 'message', 'observe']);
  const c = await makeDevice(signingKey, 'c', ['message']);
  const d = await makeDevice(signingKey, 'd', ['message']);
  const roster = await issueDeviceRoster({
    signingKey,
    seq: 5,
    issuedAt: NOW,
    devices: [a.cert, b.cert, c.cert],
  });
  const revocation = await issueDeviceRevocationList({
    signingKey,
    seq: 7,
    issuedAt: NOW,
    revokedDeviceIds: [],
  });
  const revokedC = await issueDeviceRevocationList({
    signingKey,
    seq: 8,
    issuedAt: NOW,
    revokedDeviceIds: [c.cert.deviceId],
  });
  const signingKeyRevocation = await issueSigningKeyRevocation({
    masterPrivateKey: master.keyPair.privateKey,
    userId: master.userId,
    seq: 2,
    issuedAt: NOW,
    revokedSigningKeyIds: [],
  });
  return {
    master,
    signingKey,
    devices: { a, b, c, d },
    roster,
    revocation,
    revokedC,
    signingKeyRevocation,
  };
}

let world: IWorld;
let other: IWorld;

beforeAll(async () => {
  world = await buildWorld(PHRASE);
  other = await buildWorld(OTHER_PHRASE);
});

afterEach(() => {
  vi.useRealTimers();
});

function identity(
  w: IWorld,
  device: IDevice,
  over: Partial<IDeviceHandshakeIdentity> = {},
): IDeviceHandshakeIdentity {
  return {
    masterPublicKey: w.master.publicKey,
    signingKeyCertificate: w.signingKey.certificate,
    deviceCertificate: device.cert,
    signPrivateKey: device.sign.privateKey,
    kaPrivateKey: device.ka.privateKey,
    roster: w.roster,
    revocation: w.revocation,
    signingKeyRevocation: w.signingKeyRevocation,
    marks: {},
    ...over,
  };
}

type TSide = 'a' | 'b';
type TSideOptions = Omit<
  IDeviceHandshakeOptions,
  'send' | 'role' | 'localFingerprint' | 'remoteFingerprint'
> &
  Partial<Pick<IDeviceHandshakeOptions, 'localFingerprint' | 'remoteFingerprint'>>;

/** What reaches the other side, or `[]` to drop. Frames cross as JSON, as a carrier would pass them. */
type TRelay = (from: TSide, frame: unknown) => unknown[] | Promise<unknown[]>;

interface IRun {
  readonly a: Promise<IDeviceHandshakeResult>;
  readonly b: Promise<IDeviceHandshakeResult>;
  readonly sent: Record<TSide, TDeviceHandshakeFrame[]>;
}

function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** a is the initiator, b the responder. */
function run(
  aOptions: TSideOptions,
  bOptions: TSideOptions,
  relay: TRelay = (_from, frame) => [frame],
): IRun {
  const sent: Record<TSide, TDeviceHandshakeFrame[]> = { a: [], b: [] };
  const controllers: Partial<Record<TSide, { onFrame(frame: unknown): void }>> = {};
  // One ordered lane per direction, as a data channel is.
  const lanes: Record<TSide, Promise<void>> = { a: Promise.resolve(), b: Promise.resolve() };
  const deliver = (from: TSide, frame: TDeviceHandshakeFrame): void => {
    sent[from].push(frame);
    const to: TSide = from === 'a' ? 'b' : 'a';
    const copy = wire(frame);
    lanes[from] = lanes[from].then(async () => {
      for (const routed of await relay(from, copy)) controllers[to]?.onFrame(routed);
    });
  };
  const a = startDeviceHandshake({
    localFingerprint: FP_A,
    remoteFingerprint: FP_B,
    ...aOptions,
    role: 'initiator',
    send: (frame) => deliver('a', frame),
  });
  const b = startDeviceHandshake({
    localFingerprint: FP_B,
    remoteFingerprint: FP_A,
    ...bOptions,
    role: 'responder',
    send: (frame) => deliver('b', frame),
  });
  controllers.a = a;
  controllers.b = b;
  // Observed rejections are asserted by the tests; never leave one unhandled.
  a.result.catch(() => undefined);
  b.result.catch(() => undefined);
  return { a: a.result, b: b.result, sent };
}

function sideA(over: Partial<TSideOptions> = {}): TSideOptions {
  return {
    identity: identity(world, world.devices.a),
    sessionDescriptor: world.devices.a.session,
    expectedPeerDeviceId: world.devices.b.cert.deviceId,
    locality: 'another-host',
    localPolicy: ALL,
    now: () => NOW,
    ...over,
  };
}

function sideB(over: Partial<TSideOptions> = {}): TSideOptions {
  return {
    identity: identity(world, world.devices.b),
    sessionDescriptor: world.devices.b.session,
    locality: 'another-host',
    localPolicy: ALL,
    now: () => NOW,
    ...over,
  };
}

async function refusal(result: Promise<IDeviceHandshakeResult>): Promise<DeviceHandshakeError> {
  try {
    await result;
  } catch (error) {
    expect(error).toBeInstanceOf(DeviceHandshakeError);
    return error as DeviceHandshakeError;
  }
  throw new Error('expected the handshake to be refused');
}

function kinds(frames: readonly TDeviceHandshakeFrame[]): string[] {
  return frames.map((frame) => frame.t);
}

function containsCertificate(frames: readonly TDeviceHandshakeFrame[]): boolean {
  return JSON.stringify(frames).includes(IDENTITY_PURPOSES.deviceCert);
}

// ── Pairwise secret ────────────────────────────────────────────────────────────────────────────

describe('pairwise secret S_AB', () => {
  it('is the same value on both sides, 32 bytes, and differs per pair and per kaEpoch', async () => {
    const { a, b, c } = world.devices;
    const ab = await derivePairwiseSecret({
      ownKaPrivateKey: a.ka.privateKey,
      own: a.cert,
      peer: b.cert,
    });
    const ba = await derivePairwiseSecret({
      ownKaPrivateKey: b.ka.privateKey,
      own: b.cert,
      peer: a.cert,
    });
    const ac = await derivePairwiseSecret({
      ownKaPrivateKey: a.ka.privateKey,
      own: a.cert,
      peer: c.cert,
    });
    expect(ab).toHaveLength(32);
    expect(ab).toEqual(ba);
    expect(ab).not.toEqual(ac);
    const rotated = { ...b.cert, kaEpoch: 2 };
    const abRotated = await derivePairwiseSecret({
      ownKaPrivateKey: a.ka.privateKey,
      own: a.cert,
      peer: rotated,
    });
    expect(abRotated).not.toEqual(ab);
  });

  it('refuses two different users and a device paired with itself', async () => {
    const { a } = world.devices;
    await expect(
      derivePairwiseSecret({
        ownKaPrivateKey: a.ka.privateKey,
        own: a.cert,
        peer: other.devices.b.cert,
      }),
    ).rejects.toThrow(/user/);
    await expect(
      derivePairwiseSecret({ ownKaPrivateKey: a.ka.privateKey, own: a.cert, peer: a.cert }),
    ).rejects.toThrow(/itself/);
  });
});

// ── Admission ──────────────────────────────────────────────────────────────────────────────────

describe('device handshake — honest pair', () => {
  it('admits both sides with the mesh admission each one proved', async () => {
    const { a, b, sent } = run(sideA(), sideB());
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.admission).toEqual({
      trust: 'same-user-different-host',
      locality: 'another-host',
      workspace: world.devices.b.session.workspaceClaim,
      deviceId: world.devices.b.cert.deviceId,
      sessionId: world.devices.b.session.sessionId,
      capabilities: ['drive', 'message', 'observe'],
    });
    expect(rb.admission.deviceId).toBe(world.devices.a.cert.deviceId);
    expect(rb.admission.capabilities).toEqual(['handoff', 'message', 'presence']);
    expect(ra.freshness).toBe('fresh');
    expect(ra.marks.bySigningKey?.[world.signingKey.certificate.signingKeyId]).toEqual({
      rosterSeq: 5,
      revocationSeq: 7,
    });
    expect(ra.marks.signingKeyRevocationSeq).toBe(2);
    expect(kinds(sent.a)).toEqual(['dh-nonce', 'dh-pre', 'dh-hello', 'dh-prove']);
    expect(kinds(sent.b)).toEqual(['dh-nonce', 'dh-pre', 'dh-hello', 'dh-prove']);
  });

  it('grants only the intersection of the certificate and local policy', async () => {
    const { a } = run(sideA({ localPolicy: ['message', 'presence'] }), sideB());
    expect((await a).admission.capabilities).toEqual(['message']);
  });

  it('reports same-host trust only for a same-host carrier', async () => {
    const { a } = run(sideA({ locality: 'same-host' }), sideB({ locality: 'same-host' }));
    const result = await a;
    expect(result.admission.trust).toBe('same-user-same-host');
    expect(result.admission.locality).toBe('same-host');
  });
});

describe('device handshake — channel binding and pre-proof', () => {
  it('refuses a relay in the middle (each side sees different fingerprints) before any certificate', async () => {
    // a ↔ relay ↔ b: a's DTLS peer is the relay (FP_R1), b's DTLS peer is the relay (FP_R2).
    const { a, b, sent } = run(
      sideA({ localFingerprint: FP_A, remoteFingerprint: FP_R1, timeoutMs: 500 }),
      sideB({ localFingerprint: FP_B, remoteFingerprint: FP_R2, timeoutMs: 500 }),
    );
    expect((await refusal(b)).reason).toBe('pre-proof-failed');
    expect((await refusal(a)).reason).toBe('timeout');
    expect(containsCertificate(sent.a)).toBe(false);
    expect(containsCertificate(sent.b)).toBe(false);
    expect(kinds(sent.b)).toEqual(['dh-nonce']);
  });

  it('never sends a certificate to a stranger: a device of another user is refused at the pre-proof', async () => {
    const stranger = other.devices.b;
    const { a, b, sent } = run(
      sideA({ timeoutMs: 500 }),
      sideB({
        identity: identity(other, stranger),
        sessionDescriptor: stranger.session,
        timeoutMs: 500,
      }),
    );
    expect((await refusal(b)).reason).toBe('pre-proof-failed');
    expect((await refusal(a)).reason).toBe('timeout');
    expect(containsCertificate(sent.a)).toBe(false);
    expect(containsCertificate(sent.b)).toBe(false);
  });

  it('refuses a responder that answers as a different rostered device than the one expected', async () => {
    const { a, b, sent } = run(
      sideA({ timeoutMs: 500 }),
      sideB({
        identity: identity(world, world.devices.c),
        sessionDescriptor: world.devices.c.session,
      }),
    );
    expect((await refusal(b)).reason).toBe('pre-proof-failed');
    expect((await refusal(a)).reason).toBe('timeout');
    expect(containsCertificate(sent.a)).toBe(false);
    expect(containsCertificate(sent.b)).toBe(false);
  });

  it('refuses a reflected pre-proof: the initiator hears its own frames back', async () => {
    const sent: TDeviceHandshakeFrame[] = [];
    const reflector: { onFrame(frame: unknown): void }[] = [];
    const controller = startDeviceHandshake({
      ...sideA(),
      localFingerprint: FP_A,
      remoteFingerprint: FP_B,
      role: 'initiator',
      send: (frame) => {
        sent.push(frame);
        queueMicrotask(() => reflector[0]?.onFrame(wire(frame)));
      },
    });
    reflector.push(controller);
    expect((await refusal(controller.result)).reason).toBe('pre-proof-failed');
    // Its own nonce coming back is recognised before it computes any proof.
    expect(kinds(sent)).toEqual(['dh-nonce']);
  });

  it('refuses a reflected pre-proof even when the nonce round is honest', async () => {
    // The relay passes a's pre on to b, then hands a its own pre in place of b's.
    let aPre: unknown;
    const { a } = run(sideA(), sideB({ timeoutMs: 500 }), (from, frame) => {
      const t = (frame as { t: string }).t;
      if (from === 'a' && t === 'dh-pre') aPre = frame;
      if (from === 'b' && t === 'dh-pre') return [aPre];
      return [frame];
    });
    expect((await refusal(a)).reason).toBe('pre-proof-failed');
  });

  it('refuses a device paired with itself', async () => {
    const { a, sent } = run(
      sideA({ expectedPeerDeviceId: world.devices.a.cert.deviceId }),
      sideB(),
    );
    expect((await refusal(a)).reason).toBe('unknown-peer');
    expect(sent.a).toEqual([]);
  });

  it('refuses to start toward a peer that is not in the roster or is revoked', async () => {
    const notRostered = run(
      sideA({ expectedPeerDeviceId: world.devices.d.cert.deviceId }),
      sideB(),
    );
    expect((await refusal(notRostered.a)).reason).toBe('unknown-peer');
    const revoked = run(
      sideA({
        expectedPeerDeviceId: world.devices.c.cert.deviceId,
        identity: identity(world, world.devices.a, { revocation: world.revokedC }),
      }),
      sideB(),
    );
    expect((await refusal(revoked.a)).reason).toBe('unknown-peer');
  });
});

describe('device handshake — replay and reflection of proofs', () => {
  it('refuses frames recorded from an earlier session on the same channel fingerprints', async () => {
    const first = run(sideA(), sideB());
    await Promise.all([first.a, first.b]);
    // A second responder session hears the recorded initiator frames verbatim.
    const sent: TDeviceHandshakeFrame[] = [];
    const responder = startDeviceHandshake({
      ...sideB(),
      localFingerprint: FP_B,
      remoteFingerprint: FP_A,
      role: 'responder',
      send: (frame) => sent.push(frame),
    });
    for (const frame of first.sent.a) responder.onFrame(wire(frame));
    expect((await refusal(responder.result)).reason).toBe('pre-proof-failed');
    expect(kinds(sent)).toEqual(['dh-nonce']);
  });

  it('refuses a prove recorded from an earlier session spliced into a fresh one', async () => {
    const first = run(sideA(), sideB());
    await Promise.all([first.a, first.b]);
    const recordedProve = first.sent.b.find((frame) => frame.t === 'dh-prove');
    const second = run(sideA(), sideB(), (from, frame) =>
      from === 'b' && (frame as { t: string }).t === 'dh-prove' ? [wire(recordedProve)] : [frame],
    );
    expect((await refusal(second.a)).reason).toBe('signature-invalid');
  });

  it('refuses a reflected prove: the initiator is shown its own proof as the responder', async () => {
    let captured!: (frame: unknown) => void;
    const aProve = new Promise<unknown>((resolve) => {
      captured = resolve;
    });
    const { a } = run(sideA(), sideB(), async (from, frame) => {
      if ((frame as { t: string }).t !== 'dh-prove') return [frame];
      if (from === 'a') {
        captured(frame);
        return [frame];
      }
      return [await aProve];
    });
    expect((await refusal(a)).reason).toBe('identity-mismatch');
  });

  it('refuses a duplicated frame', async () => {
    const { b } = run(sideA(), sideB(), (from, frame) =>
      from === 'a' && (frame as { t: string }).t === 'dh-hello' ? [frame, frame] : [frame],
    );
    expect((await refusal(b)).reason).toBe('unexpected-frame');
  });

  it('refuses a signature made for another purpose over the same transcript', async () => {
    const nonces: Partial<Record<TSide, string>> = {};
    const hellos: Partial<Record<TSide, unknown>> = {};
    const { a } = run(sideA(), sideB(), async (from, frame) => {
      const f = frame as { t: string; nonce?: string };
      if (f.t === 'dh-nonce') nonces[from] = f.nonce;
      if (f.t === 'dh-hello') hellos[from] = frame;
      if (from !== 'b' || f.t !== 'dh-prove') return [frame];
      // The right transcript, signed by the right key, under another purpose's ctx.
      const fields = handshakeTranscriptFields({
        signerRole: 'responder',
        fingerprintInitiator: FP_A,
        fingerprintResponder: FP_B,
        nonceInitiator: nonces.a as string,
        nonceResponder: nonces.b as string,
        helloInitiator: hellos.a as never,
        helloResponder: hellos.b as never,
        signerDeviceId: world.devices.b.cert.deviceId,
        peerDeviceId: world.devices.a.cert.deviceId,
        sessionDescriptorSig: world.devices.b.session.sig,
      });
      const honest = await signCanonical(
        world.devices.b.sign.privateKey,
        canonicalBytes(IDENTITY_PURPOSES.handshake, fields),
      );
      const foreign = await signCanonical(
        world.devices.b.sign.privateKey,
        canonicalBytes(IDENTITY_PURPOSES.sessionDesc, fields),
      );
      expect(honest).not.toBe(foreign);
      return [{ ...f, sig: foreign }];
    });
    expect((await refusal(a)).reason).toBe('signature-invalid');
  });

  it('accepts the same transcript signed under the handshake purpose (the cross-purpose baseline)', async () => {
    const nonces: Partial<Record<TSide, string>> = {};
    const hellos: Partial<Record<TSide, unknown>> = {};
    const { a } = run(sideA(), sideB(), async (from, frame) => {
      const f = frame as { t: string; nonce?: string };
      if (f.t === 'dh-nonce') nonces[from] = f.nonce;
      if (f.t === 'dh-hello') hellos[from] = frame;
      if (from !== 'b' || f.t !== 'dh-prove') return [frame];
      const fields = handshakeTranscriptFields({
        signerRole: 'responder',
        fingerprintInitiator: FP_A,
        fingerprintResponder: FP_B,
        nonceInitiator: nonces.a as string,
        nonceResponder: nonces.b as string,
        helloInitiator: hellos.a as never,
        helloResponder: hellos.b as never,
        signerDeviceId: world.devices.b.cert.deviceId,
        peerDeviceId: world.devices.a.cert.deviceId,
        sessionDescriptorSig: world.devices.b.session.sig,
      });
      const sig = await signCanonical(
        world.devices.b.sign.privateKey,
        canonicalBytes(IDENTITY_PURPOSES.handshake, fields),
      );
      return [{ ...f, sig }];
    });
    expect((await a).admission.deviceId).toBe(world.devices.b.cert.deviceId);
  });
});

describe('device handshake — protocol version', () => {
  it('refuses a hello naming another protocol version', async () => {
    const { a } = run(sideA(), sideB(), (from, frame) =>
      from === 'b' && (frame as { t: string }).t === 'dh-hello'
        ? [{ ...(frame as object), proto: 2 }]
        : [frame],
    );
    expect((await refusal(a)).reason).toBe('unsupported-protocol');
  });
});

describe('device handshake — chain verification', () => {
  it('refuses a prove carrying another user’s chain', async () => {
    const stranger = other.devices.b;
    const { a } = run(sideA(), sideB(), (from, frame) => {
      const f = frame as { t: string };
      if (from === 'b' && f.t === 'dh-prove') {
        return [{ ...f, signingKeyCert: other.signingKey.certificate, deviceCert: stranger.cert }];
      }
      return [frame];
    });
    const error = await refusal(a);
    expect(error.reason).toBe('chain');
    expect(error.chain).toEqual({
      ok: false,
      reason: 'signature-invalid',
      subject: 'signing-key-cert',
    });
  });

  it('refuses a device revoked by a list fetched before remote admission', async () => {
    const updates: IListUpdate[] = [];
    const { b } = run(
      sideA({
        identity: identity(world, world.devices.c),
        sessionDescriptor: world.devices.c.session,
        expectedPeerDeviceId: world.devices.b.cert.deviceId,
      }),
      sideB({
        fetchLatestLists: () => Promise.resolve(wire({ revocation: world.revokedC })),
        onListsAdopted: (update) => updates.push(update),
      }),
    );
    const error = await refusal(b);
    expect(error.reason).toBe('chain');
    expect(error.chain).toEqual({ ok: false, reason: 'revoked', subject: 'revocation' });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.revocation?.seq).toBe(8);
    expect(
      updates[0]?.marks.bySigningKey?.[world.signingKey.certificate.signingKeyId]?.revocationSeq,
    ).toBe(8);
  });

  it('refuses a revoked device at the pre-proof when the local list already names it', async () => {
    const { b, sent } = run(
      sideA({
        identity: identity(world, world.devices.c),
        sessionDescriptor: world.devices.c.session,
        expectedPeerDeviceId: world.devices.b.cert.deviceId,
      }),
      sideB({ identity: identity(world, world.devices.b, { revocation: world.revokedC }) }),
    );
    expect((await refusal(b)).reason).toBe('pre-proof-failed');
    expect(containsCertificate(sent.b)).toBe(false);
  });

  it('refuses a device dropped from a newer roster', async () => {
    const newer = await issueDeviceRoster({
      signingKey: world.signingKey,
      seq: 6,
      issuedAt: NOW,
      devices: [world.devices.a.cert, world.devices.b.cert],
    });
    const { b } = run(
      sideA({
        identity: identity(world, world.devices.c),
        sessionDescriptor: world.devices.c.session,
        expectedPeerDeviceId: world.devices.b.cert.deviceId,
      }),
      sideB({ fetchLatestLists: () => Promise.resolve(wire({ roster: newer })) }),
    );
    const error = await refusal(b);
    expect(error.chain).toEqual({ ok: false, reason: 'not-in-roster', subject: 'roster' });
  });

  it('refuses when the local lists are rolled back below the marks already accepted', async () => {
    const { b } = run(
      sideA(),
      sideB({
        identity: identity(world, world.devices.b, {
          marks: {
            bySigningKey: { [world.signingKey.certificate.signingKeyId]: { revocationSeq: 9 } },
          },
        }),
      }),
    );
    expect((await refusal(b)).chain).toEqual({
      ok: false,
      reason: 'rolled-back',
      subject: 'revocation',
    });
  });

  it('ignores a fetched list that is older, forged or from another user', async () => {
    const forged = { ...world.revokedC, seq: 99 };
    const { b } = run(
      sideA(),
      sideB({
        identity: identity(world, world.devices.b, { revocation: world.revokedC }),
        fetchLatestLists: () =>
          Promise.resolve(
            wire({ revocation: forged, roster: other.roster, signingKeyRevocation: 'x' }),
          ),
      }),
    );
    const result = await b;
    expect(
      result.marks.bySigningKey?.[world.signingKey.certificate.signingKeyId]?.revocationSeq,
    ).toBe(8);
  });
});

describe('device handshake — gossip', () => {
  it('hands the newer list to the side that is behind, which verifies it and advances its marks', async () => {
    const aUpdates: IListUpdate[] = [];
    const bUpdates: IListUpdate[] = [];
    const { a, b, sent } = run(
      sideA({ onListsAdopted: (update) => aUpdates.push(update) }),
      sideB({
        identity: identity(world, world.devices.b, { revocation: world.revokedC }),
        onListsAdopted: (update) => bUpdates.push(update),
      }),
    );
    const [ra, rb] = await Promise.all([a, b]);
    expect(bUpdates).toEqual([]);
    expect(aUpdates).toHaveLength(1);
    expect(aUpdates[0]?.revocation).toEqual(world.revokedC);
    expect(ra.marks.bySigningKey?.[world.signingKey.certificate.signingKeyId]?.revocationSeq).toBe(
      8,
    );
    expect(rb.marks.bySigningKey?.[world.signingKey.certificate.signingKeyId]?.revocationSeq).toBe(
      8,
    );
    const bProve = sent.b.find((frame) => frame.t === 'dh-prove');
    const aProve = sent.a.find((frame) => frame.t === 'dh-prove');
    expect(bProve && 'revocation' in bProve).toBe(true);
    expect(aProve && 'revocation' in aProve).toBe(false);
  });

  it('refuses gossip that does not match the seq its sender declared', async () => {
    const { a } = run(
      sideA(),
      sideB({ identity: identity(world, world.devices.b, { revocation: world.revokedC }) }),
      (from, frame) => {
        const f = frame as { t: string };
        if (from === 'b' && f.t === 'dh-prove') return [{ ...f, revocation: world.revocation }];
        return [frame];
      },
    );
    expect((await refusal(a)).reason).toBe('gossip-invalid');
  });

  it('refuses gossip that is not signed by the signing key', async () => {
    const forged = { ...world.revokedC, revokedDeviceIds: [] };
    const { a } = run(
      sideA(),
      sideB({ identity: identity(world, world.devices.b, { revocation: world.revokedC }) }),
      (from, frame) => {
        const f = frame as { t: string };
        if (from === 'b' && f.t === 'dh-prove') return [{ ...f, revocation: forged }];
        return [frame];
      },
    );
    expect((await refusal(a)).reason).toBe('gossip-invalid');
  });

  it('refuses a list withheld by a peer that declared a newer one', async () => {
    const { a } = run(
      sideA(),
      sideB({ identity: identity(world, world.devices.b, { revocation: world.revokedC }) }),
      (from, frame) => {
        const f = frame as { t: string; revocation?: unknown };
        if (from === 'b' && f.t === 'dh-prove') {
          const { revocation: _dropped, ...rest } = f;
          return [rest];
        }
        return [frame];
      },
    );
    expect((await refusal(a)).reason).toBe('gossip-invalid');
  });
});

describe('device handshake — freshness (D7)', () => {
  const expired = (hoursPastExpiry: number): number =>
    NOW + REVOCATION_LIST_VALIDITY_MS + hoursPastExpiry * HOUR_MS;

  it('admits a remote peer with a warning while the lists are within the 72 h grace', async () => {
    const at = expired(10);
    const { a } = run(sideA({ now: () => at }), sideB({ now: () => at }));
    const result = await a;
    expect(result.freshness).toBe('grace');
    expect(result.listsExpiredAt).toBe(NOW + REVOCATION_LIST_VALIDITY_MS);
  });

  it('fails closed for a remote peer once the grace has passed', async () => {
    const at = expired(REMOTE_ADMISSION_GRACE_MS / HOUR_MS + 1);
    const { a } = run(sideA({ now: () => at }), sideB({ now: () => at }));
    const error = await refusal(a);
    expect(error.chain?.reason).toBe('stale');
  });

  it('keeps admitting a same-host peer after the grace, and says so', async () => {
    const at = expired(REMOTE_ADMISSION_GRACE_MS / HOUR_MS + 1);
    const { a } = run(
      sideA({ now: () => at, locality: 'same-host' }),
      sideB({ now: () => at, locality: 'same-host' }),
    );
    const result = await a;
    expect(result.freshness).toBe('stale-same-host');
    expect(result.admission.trust).toBe('same-user-same-host');
  });

  it('uses fresher lists a signing-key holder returns, and needs no grace then', async () => {
    const at = expired(REMOTE_ADMISSION_GRACE_MS / HOUR_MS + 1);
    const fresh = await issueDeviceRevocationList({
      signingKey: world.signingKey,
      seq: 9,
      issuedAt: at,
      revokedDeviceIds: [],
    });
    const freshRoster = await issueDeviceRoster({
      signingKey: world.signingKey,
      seq: 6,
      issuedAt: at,
      devices: [world.devices.a.cert, world.devices.b.cert],
    });
    const { a } = run(
      sideA({
        now: () => at,
        fetchLatestLists: () => Promise.resolve(wire({ revocation: fresh, roster: freshRoster })),
      }),
      sideB({ now: () => at, timeoutMs: 2_000 }),
    );
    const result = await a;
    expect(result.freshness).toBe('fresh');
  });

  it('bounds the freshness lookup to 3 s, aborts it, then applies the grace', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const at = expired(1);
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { a } = run(
      sideA({
        now: () => at,
        fetchLatestLists: (s) => {
          signal = s;
          started();
          return new Promise<unknown>(() => undefined);
        },
      }),
      sideB({ now: () => at }),
    );
    await lookupStarted;
    let settled = false;
    void a.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(FRESHNESS_LOOKUP_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await a;
    expect(signal?.aborted).toBe(true);
    expect(result.freshness).toBe('grace');
  });

  it('does not run the lookup for a same-host peer', async () => {
    const lookup = vi.fn(() => Promise.resolve(undefined));
    const { a } = run(
      sideA({ locality: 'same-host', fetchLatestLists: lookup }),
      sideB({ locality: 'same-host' }),
    );
    await a;
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a lookup that throws is treated as no signing-key holder online', async () => {
    const { a } = run(
      sideA({ fetchLatestLists: () => Promise.reject(new Error('offline')) }),
      sideB(),
    );
    expect((await a).freshness).toBe('fresh');
  });
});

describe('device handshake — malformed input', () => {
  const secretish = 'S3CRET-VALUE-DO-NOT-ECHO';
  const junk: unknown[] = [
    null,
    42,
    'dh-nonce',
    [],
    { t: 'dh-nonce' },
    { t: 'dh-nonce', nonce: secretish },
    { t: 'dh-nonce', nonce: 'A'.repeat(100_000) },
    { t: 'dh-pre', mac: secretish },
    {
      t: 'dh-hello',
      ctx: secretish,
      proto: 1,
      rosterSeq: 1,
      revocationSeq: 1,
      signingKeyRevocationSeq: 1,
    },
    { t: 'dh-prove', sig: secretish },
    { t: secretish },
    { t: 'dh-nonce', nonce: 'AAAAAAAAAAAAAAAAAAAAAA', extra: secretish },
    Object.create({ t: 'dh-nonce', nonce: 'AAAAAAAAAAAAAAAAAAAAAA' }) as unknown,
  ];

  for (const [i, frame] of junk.entries()) {
    it(`refuses malformed frame #${i} without throwing or echoing it`, async () => {
      const controller = startDeviceHandshake({
        ...sideB(),
        localFingerprint: FP_B,
        remoteFingerprint: FP_A,
        role: 'responder',
        send: () => undefined,
      });
      expect(() => controller.onFrame(frame)).not.toThrow();
      const error = await refusal(controller.result);
      expect(error.reason).toBe('malformed-frame');
      expect(error.message).not.toContain(secretish);
      expect(error.message).not.toContain('AAAAAAAAAA');
    });
  }

  it('times out a silent peer', async () => {
    const controller = startDeviceHandshake({
      ...sideB({ timeoutMs: 50 }),
      localFingerprint: FP_B,
      remoteFingerprint: FP_A,
      role: 'responder',
      send: () => undefined,
    });
    expect((await refusal(controller.result)).reason).toBe('timeout');
  });

  it('ignores frames after it settles and never throws from onFrame', async () => {
    const controller = startDeviceHandshake({
      ...sideB({ timeoutMs: 20 }),
      localFingerprint: FP_B,
      remoteFingerprint: FP_A,
      role: 'responder',
      send: () => undefined,
    });
    await refusal(controller.result);
    expect(() =>
      controller.onFrame({ t: 'dh-nonce', nonce: 'AAAAAAAAAAAAAAAAAAAAAA' }),
    ).not.toThrow();
  });

  it('settles as a refusal when a send throws', async () => {
    const controller = startDeviceHandshake({
      ...sideB(),
      localFingerprint: FP_B,
      remoteFingerprint: FP_A,
      role: 'responder',
      send: () => {
        throw new Error('channel closed');
      },
    });
    expect((await refusal(controller.result)).reason).toBe('internal');
  });

  it('refuses identical local and remote fingerprints (a channel looped back on itself)', async () => {
    const controller = startDeviceHandshake({
      ...sideB(),
      localFingerprint: FP_B,
      remoteFingerprint: FP_B,
      role: 'responder',
      send: () => undefined,
    });
    expect((await refusal(controller.result)).reason).toBe('channel-invalid');
  });
});
