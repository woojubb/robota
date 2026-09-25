import { beforeAll, describe, expect, it } from 'vitest';

import {
  DEVICE_CERTIFICATE_VALIDITY_MS,
  SIGNING_KEY_CERTIFICATE_VALIDITY_MS,
  certifyDevice,
  certifySigningKey,
  decodeDeviceCertificate,
  deviceCertificateBytes,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  generateSigningKeyPair,
  type IDeviceCertificate,
  type ISigningKey,
  type ISigningKeyCertificate,
} from '../identity/certificates.js';
import {
  IDENTITY_CLOCK_SKEW_MS,
  IDENTITY_PURPOSES,
  canonicalBytes,
  signCanonical,
} from '../identity/encoding.js';
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
import {
  verifyDeviceChain,
  verifySessionDescriptor,
  type IVerifyDeviceChainInput,
} from '../identity/verify-chain.js';

const NOW = 1_800_000_000_000;
const PHRASE =
  'hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length';
const OTHER_PHRASE =
  'all hour make first leader extend hole alien behind guard gospel lava path output census museum junior mass reopen famous sing advance salt reform';

interface IWorld {
  readonly master: IMasterKey;
  readonly signingKey: ISigningKey;
  readonly signingKeyCert: ISigningKeyCertificate;
  readonly deviceSign: CryptoKeyPair;
  readonly deviceCert: IDeviceCertificate;
  readonly roster: IDeviceRoster;
  readonly revocation: IDeviceRevocationList;
  readonly signingKeyRevocation: ISigningKeyRevocation;
  readonly session: ISessionDescriptor;
}

async function buildWorld(master: IMasterKey, alg: 'Ed25519' | 'ES256'): Promise<IWorld> {
  const signing = await generateSigningKeyPair({ alg, extractable: false });
  const signingKeyCert = await certifySigningKey({
    masterPrivateKey: master.keyPair.privateKey,
    userId: master.userId,
    signingPublicKey: signing.publicKey,
    issuedAt: NOW,
  });
  const signingKey: ISigningKey = { certificate: signingKeyCert, privateKey: signing.privateKey };
  const deviceSign = await generateDeviceSignKeyPair(false);
  const deviceKa = await generateDeviceKeyAgreementKeyPair(false);
  const deviceCert = await certifyDevice({
    signingKey,
    signPublicKey: deviceSign.publicKey,
    kaPublicKey: deviceKa.publicKey,
    kaEpoch: 3,
    name: 'Laptop — 서재',
    capabilities: ['message', 'presence', 'handoff'],
    issuedAt: NOW,
  });
  const roster = await issueDeviceRoster({ signingKey, seq: 5, issuedAt: NOW, devices: [deviceCert] });
  const revocation = await issueDeviceRevocationList({
    signingKey,
    seq: 7,
    issuedAt: NOW,
    revokedDeviceIds: [],
  });
  const signingKeyRevocation = await issueSigningKeyRevocation({
    masterPrivateKey: master.keyPair.privateKey,
    userId: master.userId,
    seq: 2,
    issuedAt: NOW,
    revokedSigningKeyIds: [],
  });
  const session = await signSessionDescriptor({
    signPrivateKey: deviceSign.privateKey,
    deviceId: deviceCert.deviceId,
    sessionId: 'c2Vzc2lvbi0x',
    workspaceClaim: 'd29ya3NwYWNl',
    startedAt: NOW,
  });
  return {
    master,
    signingKey,
    signingKeyCert,
    deviceSign,
    deviceCert,
    roster,
    revocation,
    signingKeyRevocation,
    session,
  };
}

let world: IWorld;
let otherWorld: IWorld;

beforeAll(async () => {
  world = await buildWorld(await deriveMasterKey(PHRASE), 'Ed25519');
  otherWorld = await buildWorld(await deriveMasterKey(OTHER_PHRASE), 'ES256');
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function full(overrides: Partial<IVerifyDeviceChainInput> = {}): IVerifyDeviceChainInput {
  return {
    masterPublicKey: world.master.publicKey,
    signingKeyCert: world.signingKeyCert,
    deviceCert: world.deviceCert,
    roster: world.roster,
    revocation: world.revocation,
    signingKeyRevocation: world.signingKeyRevocation,
    now: NOW,
    ...overrides,
  };
}

/** A P-256 SPKI whose point tag claims compressed form — same DER prefix, not an uncompressed point. */
function compressedTag(spki: string): string {
  const bytes = Uint8Array.from(atob(spki.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  bytes[26] = 0x02;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Replace one character of a base64url value with another valid one, keeping it canonical. */
function flip(value: string, at = 5): string {
  const c = value[at] === 'A' ? 'B' : 'A';
  return value.slice(0, at) + c + value.slice(at + 1);
}

describe('verifyDeviceChain — acceptance', () => {
  it('accepts a complete Ed25519-signing-key chain and reports what it accepted', async () => {
    const verdict = await verifyDeviceChain(full());
    expect(verdict).toEqual({
      ok: true,
      userId: world.master.userId,
      signingKeyId: world.signingKeyCert.signingKeyId,
      deviceId: world.deviceCert.deviceId,
      capabilities: ['handoff', 'message', 'presence'],
      deviceCertificate: world.deviceCert,
      accepted: { rosterSeq: 5, revocationSeq: 7, signingKeyRevocationSeq: 2 },
    });
  });

  it('accepts an ES256 signing key and a chain with no optional lists', async () => {
    const verdict = await verifyDeviceChain({
      masterPublicKey: otherWorld.master.publicKey,
      signingKeyCert: otherWorld.signingKeyCert,
      deviceCert: otherWorld.deviceCert,
      now: NOW,
    });
    expect(verdict.ok).toBe(true);
    expect(otherWorld.signingKeyCert.alg).toBe('ES256');
  });

  it('issues with the documented default lifetimes and sorted, deduplicated sets', async () => {
    expect(world.signingKeyCert.expiresAt - NOW).toBe(SIGNING_KEY_CERTIFICATE_VALIDITY_MS);
    expect(world.deviceCert.expiresAt - NOW).toBe(DEVICE_CERTIFICATE_VALIDITY_MS);
    expect(world.revocation.expiresAt - NOW).toBe(REVOCATION_LIST_VALIDITY_MS);
    expect(world.deviceCert.capabilities).toEqual(['handoff', 'message', 'presence']);
    expect(world.deviceCert.ctx).toBe('robota/device-cert/v1');
    expect(world.deviceCert.alg).toBe('ES256');
    expect(world.deviceCert.kaAlg).toBe('X25519');
  });

  it('accepts a list whose seq equals the last one seen', async () => {
    const verdict = await verifyDeviceChain(
      full({
        lastSeen: {
          signingKeyRevocationSeq: 2,
          bySigningKey: { [world.signingKeyCert.signingKeyId]: { rosterSeq: 5, revocationSeq: 7 } },
        },
      }),
    );
    expect(verdict.ok).toBe(true);
  });
});

describe('verifyDeviceChain — every rejection reason', () => {
  it('wrong-purpose: a roster presented as a revocation list, a device cert as a signing-key cert', async () => {
    expect(await verifyDeviceChain(full({ revocation: world.roster }))).toEqual({
      ok: false,
      reason: 'wrong-purpose',
      subject: 'revocation',
    });
    expect(await verifyDeviceChain(full({ signingKeyCert: world.deviceCert }))).toEqual({
      ok: false,
      reason: 'wrong-purpose',
      subject: 'signing-key-cert',
    });
    expect(await verifyDeviceChain(full({ roster: world.revocation }))).toMatchObject({
      reason: 'wrong-purpose',
      subject: 'roster',
    });
  });

  it('cross-purpose signature: relabelling a statement keeps no signature valid', async () => {
    // A roster's signature moved onto a revocation list with identical shared fields.
    const forgedRevocation = {
      ctx: IDENTITY_PURPOSES.revocation,
      userId: world.roster.userId,
      signingKeyId: world.roster.signingKeyId,
      seq: world.roster.seq,
      issuedAt: world.roster.issuedAt,
      expiresAt: world.roster.expiresAt,
      revokedDeviceIds: [],
      sig: world.roster.sig,
    };
    expect(await verifyDeviceChain(full({ revocation: forgedRevocation }))).toEqual({
      ok: false,
      reason: 'signature-invalid',
      subject: 'revocation',
    });

    // A master signature over a signing-key certificate reused as a signing-key revocation.
    const forgedSkRevocation = {
      ctx: IDENTITY_PURPOSES.signingKeyRevocation,
      userId: world.master.userId,
      seq: 99,
      issuedAt: NOW,
      revokedSigningKeyIds: [],
      sig: world.signingKeyCert.sig,
    };
    expect(await verifyDeviceChain(full({ signingKeyRevocation: forgedSkRevocation }))).toEqual({
      ok: false,
      reason: 'signature-invalid',
      subject: 'signing-key-revocation',
    });

    // The same fields under two purposes never produce the same signed bytes.
    const fields = [world.master.userId, 1, NOW];
    expect(canonicalBytes(IDENTITY_PURPOSES.roster, fields)).not.toEqual(
      canonicalBytes(IDENTITY_PURPOSES.revocation, fields),
    );
  });

  it('cross-purpose signature: a device-cert signature presented as a signing-key cert', async () => {
    const relabelled = {
      ctx: IDENTITY_PURPOSES.signingKeyCert,
      userId: world.deviceCert.userId,
      signingKeyId: world.deviceCert.deviceId,
      alg: 'ES256',
      publicKey: world.deviceCert.signKey,
      issuedAt: world.deviceCert.issuedAt,
      expiresAt: world.deviceCert.expiresAt,
      sig: world.deviceCert.sig,
    };
    expect(await verifyDeviceChain(full({ signingKeyCert: relabelled }))).toEqual({
      ok: false,
      reason: 'signature-invalid',
      subject: 'signing-key-cert',
    });
  });

  it('signature-invalid: a signing key certified by another master', async () => {
    expect(
      await verifyDeviceChain(
        full({ signingKeyCert: otherWorld.signingKeyCert, deviceCert: otherWorld.deviceCert }),
      ),
    ).toEqual({ ok: false, reason: 'signature-invalid', subject: 'signing-key-cert' });
  });

  it('user-mismatch: the master signed a certificate naming another user', async () => {
    const signing = await generateSigningKeyPair({ extractable: false });
    const cert = await certifySigningKey({
      masterPrivateKey: world.master.keyPair.privateKey,
      userId: otherWorld.master.userId,
      signingPublicKey: signing.publicKey,
      issuedAt: NOW,
    });
    expect(await verifyDeviceChain(full({ signingKeyCert: cert }))).toEqual({
      ok: false,
      reason: 'user-mismatch',
      subject: 'signing-key-cert',
    });
  });

  it('signing-key-mismatch: a device or list issued under a different signing key', async () => {
    const signing = await generateSigningKeyPair({ extractable: false });
    const secondCert = await certifySigningKey({
      masterPrivateKey: world.master.keyPair.privateKey,
      userId: world.master.userId,
      signingPublicKey: signing.publicKey,
      issuedAt: NOW,
    });
    expect(await verifyDeviceChain(full({ signingKeyCert: secondCert }))).toEqual({
      ok: false,
      reason: 'signing-key-mismatch',
      subject: 'device-cert',
    });
    const secondKey: ISigningKey = { certificate: secondCert, privateKey: signing.privateKey };
    const foreignRoster = await issueDeviceRoster({
      signingKey: secondKey,
      seq: 9,
      issuedAt: NOW,
      devices: [world.deviceCert],
    });
    expect(await verifyDeviceChain(full({ roster: foreignRoster }))).toEqual({
      ok: false,
      reason: 'signing-key-mismatch',
      subject: 'roster',
    });
  });

  it('key-id-mismatch: a signed device id that is not the hash of its key', async () => {
    const { sig: _sig, ...unsigned } = world.deviceCert;
    const lying = { ...unsigned, deviceId: otherWorld.deviceCert.deviceId };
    const sig = await signCanonical(world.signingKey.privateKey, deviceCertificateBytes(lying));
    expect(await verifyDeviceChain(full({ deviceCert: { ...lying, sig }, roster: undefined }))).toEqual({
      ok: false,
      reason: 'key-id-mismatch',
      subject: 'device-cert',
    });
  });

  it('expired / not-yet-valid honour the documented clock skew', async () => {
    const certEnd = world.signingKeyCert.expiresAt;
    const lists = { roster: undefined, revocation: undefined };
    expect((await verifyDeviceChain(full({ ...lists, now: certEnd + IDENTITY_CLOCK_SKEW_MS - 1 }))).ok).toBe(true);
    expect(await verifyDeviceChain(full({ ...lists, now: certEnd + IDENTITY_CLOCK_SKEW_MS }))).toEqual({
      ok: false,
      reason: 'expired',
      subject: 'signing-key-cert',
    });
    expect((await verifyDeviceChain(full({ now: NOW - IDENTITY_CLOCK_SKEW_MS }))).ok).toBe(true);
    expect(await verifyDeviceChain(full({ now: NOW - IDENTITY_CLOCK_SKEW_MS - 1 }))).toEqual({
      ok: false,
      reason: 'not-yet-valid',
      subject: 'signing-key-cert',
    });
  });

  it('expired: a device certificate past its end inside a live signing key', async () => {
    const deviceKa = await generateDeviceKeyAgreementKeyPair(false);
    const shortLived = await certifyDevice({
      signingKey: world.signingKey,
      signPublicKey: world.deviceSign.publicKey,
      kaPublicKey: deviceKa.publicKey,
      kaEpoch: 0,
      name: 'short',
      capabilities: ['presence'],
      issuedAt: NOW,
      expiresAt: NOW + 1000,
    });
    expect(
      await verifyDeviceChain(
        full({ deviceCert: shortLived, roster: undefined, now: NOW + 1000 + IDENTITY_CLOCK_SKEW_MS }),
      ),
    ).toEqual({ ok: false, reason: 'expired', subject: 'device-cert' });
  });

  it('revoked: the device appears in a valid revocation list', async () => {
    const revocation = await issueDeviceRevocationList({
      signingKey: world.signingKey,
      seq: 8,
      issuedAt: NOW,
      revokedDeviceIds: [otherWorld.deviceCert.deviceId, world.deviceCert.deviceId],
    });
    expect(await verifyDeviceChain(full({ revocation }))).toEqual({
      ok: false,
      reason: 'revoked',
      subject: 'revocation',
    });
  });

  it('signing-key-revoked: the master revoked the signing key', async () => {
    const skRevocation = await issueSigningKeyRevocation({
      masterPrivateKey: world.master.keyPair.privateKey,
      userId: world.master.userId,
      seq: 3,
      issuedAt: NOW,
      revokedSigningKeyIds: [world.signingKeyCert.signingKeyId],
    });
    expect(await verifyDeviceChain(full({ signingKeyRevocation: skRevocation }))).toEqual({
      ok: false,
      reason: 'signing-key-revoked',
      subject: 'signing-key-revocation',
    });
  });

  it('not-in-roster: absent, or present only as a different certificate for the same device', async () => {
    const empty = await issueDeviceRoster({
      signingKey: world.signingKey,
      seq: 6,
      issuedAt: NOW,
      devices: [],
    });
    expect(await verifyDeviceChain(full({ roster: empty }))).toEqual({
      ok: false,
      reason: 'not-in-roster',
      subject: 'roster',
    });
    const deviceKa = await generateDeviceKeyAgreementKeyPair(false);
    const reissued = await certifyDevice({
      signingKey: world.signingKey,
      signPublicKey: world.deviceSign.publicKey,
      kaPublicKey: deviceKa.publicKey,
      kaEpoch: 4,
      name: 'renamed',
      capabilities: ['presence'],
      issuedAt: NOW,
    });
    expect(reissued.deviceId).toBe(world.deviceCert.deviceId);
    const rosterWithReissue = await issueDeviceRoster({
      signingKey: world.signingKey,
      seq: 6,
      issuedAt: NOW,
      devices: [reissued],
    });
    expect(await verifyDeviceChain(full({ roster: rosterWithReissue }))).toMatchObject({
      reason: 'not-in-roster',
    });
  });

  it('stale: an expired revocation list or roster', async () => {
    const later = NOW + REVOCATION_LIST_VALIDITY_MS + IDENTITY_CLOCK_SKEW_MS;
    expect(await verifyDeviceChain(full({ roster: undefined, now: later }))).toEqual({
      ok: false,
      reason: 'stale',
      subject: 'revocation',
    });
    const shortRoster = await issueDeviceRoster({
      signingKey: world.signingKey,
      seq: 5,
      issuedAt: NOW,
      expiresAt: NOW + 10,
      devices: [world.deviceCert],
    });
    expect(
      await verifyDeviceChain(full({ roster: shortRoster, now: NOW + 10 + IDENTITY_CLOCK_SKEW_MS })),
    ).toEqual({ ok: false, reason: 'stale', subject: 'roster' });
  });

  it('an expired list inside the caller’s grace is accepted and reported; past it, stale', async () => {
    const expiry = NOW + REVOCATION_LIST_VALIDITY_MS;
    const grace = 60 * 60 * 1000;
    const inside = await verifyDeviceChain(
      full({ now: expiry + IDENTITY_CLOCK_SKEW_MS + grace - 1, listExpiryGraceMs: grace }),
    );
    expect(inside).toMatchObject({ ok: true, listsExpiredAt: expiry });
    expect(
      await verifyDeviceChain(full({ now: expiry + IDENTITY_CLOCK_SKEW_MS + grace, listExpiryGraceMs: grace })),
    ).toEqual({ ok: false, reason: 'stale', subject: 'revocation' });
    const fresh = await verifyDeviceChain(full({ listExpiryGraceMs: grace }));
    expect(fresh.ok && 'listsExpiredAt' in fresh).toBe(false);
  });

  it('stale: a list left out although one was seen before, or required', async () => {
    const skId = world.signingKeyCert.signingKeyId;
    expect(
      await verifyDeviceChain(
        full({ revocation: undefined, lastSeen: { bySigningKey: { [skId]: { revocationSeq: 7 } } } }),
      ),
    ).toEqual({ ok: false, reason: 'stale', subject: 'revocation' });
    expect(
      await verifyDeviceChain(
        full({ roster: undefined, lastSeen: { bySigningKey: { [skId]: { rosterSeq: 5 } } } }),
      ),
    ).toEqual({ ok: false, reason: 'stale', subject: 'roster' });
    expect(
      await verifyDeviceChain(
        full({ signingKeyRevocation: undefined, lastSeen: { signingKeyRevocationSeq: 2 } }),
      ),
    ).toEqual({ ok: false, reason: 'stale', subject: 'signing-key-revocation' });
    for (const [slot, subject] of [
      ['roster', 'roster'],
      ['revocation', 'revocation'],
      ['signingKeyRevocation', 'signing-key-revocation'],
    ] as const) {
      expect(
        await verifyDeviceChain(full({ [slot]: undefined, required: { [slot]: true } })),
      ).toEqual({ ok: false, reason: 'stale', subject });
    }
    expect((await verifyDeviceChain(full({ required: { roster: true, revocation: true, signingKeyRevocation: true } }))).ok).toBe(true);
  });

  it('device-list marks belong to the signing key that issued the list', async () => {
    // Another signing key's high seq does not make this key's lists look rolled back.
    const verdict = await verifyDeviceChain(
      full({ lastSeen: { bySigningKey: { [otherWorld.signingKeyCert.signingKeyId]: { rosterSeq: 40, revocationSeq: 40 } } } }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('rolled-back: any list below the last seq seen', async () => {
    const skId = world.signingKeyCert.signingKeyId;
    expect(
      await verifyDeviceChain(full({ lastSeen: { bySigningKey: { [skId]: { rosterSeq: 6 } } } })),
    ).toEqual({
      ok: false,
      reason: 'rolled-back',
      subject: 'roster',
    });
    expect(
      await verifyDeviceChain(full({ lastSeen: { bySigningKey: { [skId]: { revocationSeq: 8 } } } })),
    ).toEqual({
      ok: false,
      reason: 'rolled-back',
      subject: 'revocation',
    });
    expect(await verifyDeviceChain(full({ lastSeen: { signingKeyRevocationSeq: 3 } }))).toEqual({
      ok: false,
      reason: 'rolled-back',
      subject: 'signing-key-revocation',
    });
  });
});

type TMutation = (value: unknown) => unknown;

const STRING_MUTATION: TMutation = (v) => flip(v as string);
const NUMBER_MUTATION: TMutation = (v) => (v as number) + 1;

async function expectEveryFieldBound(
  label: string,
  original: Record<string, unknown>,
  mutations: Record<string, TMutation>,
  verify: (tampered: Record<string, unknown>) => Promise<{ ok: boolean }>,
): Promise<void> {
  expect((await verify(clone(original))).ok, `${label}: untampered`).toBe(true);
  const fields = Object.keys(original).filter((k) => k !== 'sig' && k !== 'ctx');
  expect(Object.keys(mutations).sort()).toEqual(fields.sort());
  for (const [field, mutate] of Object.entries(mutations)) {
    const tampered = clone(original);
    tampered[field] = mutate(tampered[field]);
    expect(tampered[field], `${label}.${field} mutation changes the value`).not.toEqual(original[field]);
    const verdict = await verify(tampered);
    expect(verdict.ok, `${label}.${field} must be bound by the signature`).toBe(false);
  }
}

describe('tampering any signed field is refused', () => {
  it('signing-key certificate', async () => {
    await expectEveryFieldBound(
      'signingKeyCert',
      world.signingKeyCert as unknown as Record<string, unknown>,
      {
        userId: STRING_MUTATION,
        signingKeyId: STRING_MUTATION,
        alg: () => 'ES256',
        publicKey: () => otherWorld.signingKeyCert.publicKey,
        issuedAt: NUMBER_MUTATION,
        expiresAt: NUMBER_MUTATION,
      },
      (t) => verifyDeviceChain(full({ signingKeyCert: t })),
    );
  });

  it('device certificate', async () => {
    await expectEveryFieldBound(
      'deviceCert',
      world.deviceCert as unknown as Record<string, unknown>,
      {
        userId: STRING_MUTATION,
        signingKeyId: STRING_MUTATION,
        deviceId: STRING_MUTATION,
        alg: () => 'ES384',
        signKey: () => otherWorld.deviceCert.signKey,
        kaAlg: () => 'X448',
        kaKey: () => otherWorld.deviceCert.kaKey,
        kaEpoch: NUMBER_MUTATION,
        name: () => 'Laptop — 서재 2',
        capabilities: () => ['drive', 'handoff', 'message', 'presence'],
        issuedAt: NUMBER_MUTATION,
        expiresAt: NUMBER_MUTATION,
      },
      (t) => verifyDeviceChain(full({ deviceCert: t, roster: undefined })),
    );
  });

  it('roster', async () => {
    await expectEveryFieldBound(
      'roster',
      world.roster as unknown as Record<string, unknown>,
      {
        userId: STRING_MUTATION,
        signingKeyId: STRING_MUTATION,
        seq: NUMBER_MUTATION,
        issuedAt: NUMBER_MUTATION,
        expiresAt: NUMBER_MUTATION,
        devices: (v) => [...(v as unknown[]), otherWorld.deviceCert].sort((a, b) =>
          (a as IDeviceCertificate).deviceId < (b as IDeviceCertificate).deviceId ? -1 : 1,
        ),
      },
      (t) => verifyDeviceChain(full({ roster: t })),
    );
  });

  it('revocation list', async () => {
    await expectEveryFieldBound(
      'revocation',
      world.revocation as unknown as Record<string, unknown>,
      {
        userId: STRING_MUTATION,
        signingKeyId: STRING_MUTATION,
        seq: NUMBER_MUTATION,
        issuedAt: NUMBER_MUTATION,
        expiresAt: NUMBER_MUTATION,
        revokedDeviceIds: () => [otherWorld.deviceCert.deviceId],
      },
      (t) => verifyDeviceChain(full({ revocation: t })),
    );
  });

  it('signing-key revocation', async () => {
    await expectEveryFieldBound(
      'signingKeyRevocation',
      world.signingKeyRevocation as unknown as Record<string, unknown>,
      {
        userId: STRING_MUTATION,
        seq: NUMBER_MUTATION,
        issuedAt: NUMBER_MUTATION,
        revokedSigningKeyIds: () => [otherWorld.signingKeyCert.signingKeyId],
      },
      (t) => verifyDeviceChain(full({ signingKeyRevocation: t })),
    );
  });

  it('session descriptor', async () => {
    await expectEveryFieldBound(
      'session',
      world.session as unknown as Record<string, unknown>,
      {
        sessionId: STRING_MUTATION,
        deviceId: STRING_MUTATION,
        workspaceClaim: STRING_MUTATION,
        startedAt: NUMBER_MUTATION,
        expiresAt: NUMBER_MUTATION,
      },
      (t) => verifySessionDescriptor(t, { deviceCertificate: world.deviceCert, now: NOW }),
    );
  });

  it('a flipped signature byte', async () => {
    const tampered = { ...world.deviceCert, sig: flip(world.deviceCert.sig, 10) };
    expect(await verifyDeviceChain(full({ deviceCert: tampered, roster: undefined }))).toEqual({
      ok: false,
      reason: 'signature-invalid',
      subject: 'device-cert',
    });
  });
});

describe('verifySessionDescriptor', () => {
  it('accepts a descriptor signed by the certified device key', async () => {
    expect(
      await verifySessionDescriptor(world.session, { deviceCertificate: world.deviceCert, now: NOW }),
    ).toEqual({
      ok: true,
      sessionId: 'c2Vzc2lvbi0x',
      deviceId: world.deviceCert.deviceId,
      workspaceClaim: 'd29ya3NwYWNl',
    });
  });

  it('refuses another device, another purpose, and an expired descriptor', async () => {
    expect(
      await verifySessionDescriptor(otherWorld.session, {
        deviceCertificate: world.deviceCert,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'device-mismatch', subject: 'session-desc' });
    expect(
      await verifySessionDescriptor(world.deviceCert, { deviceCertificate: world.deviceCert, now: NOW }),
    ).toEqual({ ok: false, reason: 'wrong-purpose', subject: 'session-desc' });
    expect(
      await verifySessionDescriptor(world.session, {
        deviceCertificate: world.deviceCert,
        now: world.session.expiresAt + IDENTITY_CLOCK_SKEW_MS,
      }),
    ).toEqual({ ok: false, reason: 'expired', subject: 'session-desc' });
  });

  it('refuses to sign a descriptor its own decoder would reject', async () => {
    await expect(
      signSessionDescriptor({
        signPrivateKey: world.deviceSign.privateKey,
        deviceId: world.deviceCert.deviceId,
        sessionId: 'not base64url!',
        startedAt: NOW,
      }),
    ).rejects.toThrow(/sessionId/);
  });

  it('accepts a descriptor without a workspace claim', async () => {
    const session = await signSessionDescriptor({
      signPrivateKey: world.deviceSign.privateKey,
      deviceId: world.deviceCert.deviceId,
      sessionId: 'c2Vzc2lvbi0y',
      startedAt: NOW,
    });
    expect('workspaceClaim' in session).toBe(false);
    expect(
      await verifySessionDescriptor(session, { deviceCertificate: world.deviceCert, now: NOW }),
    ).toMatchObject({ ok: true, sessionId: 'c2Vzc2lvbi0y' });
  });
});

describe('malformed input is a reason, never a throw, never an echo', () => {
  const MARKER = 'SECRET_MARKER_VALUE';
  const garbage = (): unknown[] => [
    undefined,
    null,
    42,
    MARKER,
    [],
    [MARKER],
    {},
    { ctx: MARKER },
    { ctx: 7 },
    { ...clone(world.deviceCert), extra: MARKER },
    { ...clone(world.deviceCert), sig: MARKER },
    { ...clone(world.deviceCert), sig: 'A'.repeat(100_000) },
    { ...clone(world.deviceCert), deviceId: `${MARKER}==` },
    { ...clone(world.deviceCert), signKey: world.signingKeyCert.publicKey },
    { ...clone(world.deviceCert), kaKey: world.deviceCert.signKey },
    { ...clone(world.deviceCert), name: `${MARKER}\u0000` },
    { ...clone(world.deviceCert), name: '' },
    { ...clone(world.deviceCert), capabilities: [MARKER] },
    { ...clone(world.deviceCert), capabilities: ['presence', 'message'] },
    { ...clone(world.deviceCert), capabilities: ['message', 'message'] },
    { ...clone(world.deviceCert), kaEpoch: -1 },
    { ...clone(world.deviceCert), issuedAt: 1.5 },
    { ...clone(world.deviceCert), expiresAt: world.deviceCert.issuedAt },
    { ...clone(world.deviceCert), issuedAt: Number.MAX_SAFE_INTEGER + 2 },
    { ...clone(world.deviceCert), kaEpoch: -0 },
    { ...clone(world.deviceCert), signKey: compressedTag(world.deviceCert.signKey) },
    JSON.parse(`{"__proto__": {"${MARKER}": 1}, "ctx": "robota/device-cert/v1"}`),
    Object.assign(Object.create({ inherited: MARKER }), clone(world.deviceCert)),
  ];

  it('in every slot of verifyDeviceChain', async () => {
    const slots = ['signingKeyCert', 'deviceCert', 'roster', 'revocation', 'signingKeyRevocation'] as const;
    for (const slot of slots) {
      const optional = slot === 'roster' || slot === 'revocation' || slot === 'signingKeyRevocation';
      for (const value of garbage()) {
        if (optional && value === undefined) continue;
        const verdict = await verifyDeviceChain(full({ [slot]: value }));
        expect(verdict.ok, `${slot} ← ${typeof value}`).toBe(false);
        expect(JSON.stringify(verdict)).not.toContain(MARKER);
      }
    }
  });

  it('malformed roster entries, oversized lists, and non-canonical base64url', async () => {
    const cases: unknown[] = [
      { ...clone(world.roster), devices: [{ ...clone(world.deviceCert), sig: MARKER }] },
      { ...clone(world.roster), devices: Array.from({ length: 1000 }, () => clone(world.deviceCert)) },
      { ...clone(world.roster), devices: [clone(world.deviceCert), clone(world.deviceCert)] },
    ];
    for (const roster of cases) {
      const verdict = await verifyDeviceChain(full({ roster }));
      expect(verdict).toMatchObject({ ok: false, reason: 'malformed', subject: 'roster' });
      expect(JSON.stringify(verdict)).not.toContain(MARKER);
    }
    // A signature whose final character carries non-zero padding bits decodes to the same bytes;
    // only one spelling is accepted.
    const sig = world.deviceCert.sig;
    const last = sig[sig.length - 1];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = alphabet[alphabet.indexOf(last) ^ 1];
    const nonCanonical = { ...world.deviceCert, sig: sig.slice(0, -1) + sibling };
    expect(await verifyDeviceChain(full({ deviceCert: nonCanonical, roster: undefined }))).toMatchObject({
      ok: false,
      subject: 'device-cert',
    });
    const revocation = {
      ...clone(world.revocation),
      revokedDeviceIds: Array.from({ length: 5000 }, (_, i) => flip(world.deviceCert.deviceId, i % 40)),
    };
    expect(await verifyDeviceChain(full({ revocation }))).toMatchObject({
      reason: 'malformed',
      subject: 'revocation',
    });
  });

  it('the decoder alone refuses -0 and a non-uncompressed P-256 point', () => {
    expect(decodeDeviceCertificate({ ...clone(world.deviceCert), kaEpoch: -0 })).toEqual({
      ok: false,
      reason: 'malformed',
      field: 'kaEpoch',
    });
    expect(
      decodeDeviceCertificate({ ...clone(world.deviceCert), signKey: compressedTag(world.deviceCert.signKey) }),
    ).toEqual({ ok: false, reason: 'malformed', field: 'signKey' });
    expect(decodeDeviceCertificate(clone(world.deviceCert)).ok).toBe(true);
  });

  it('in verifySessionDescriptor', async () => {
    for (const value of garbage()) {
      const verdict = await verifySessionDescriptor(value, {
        deviceCertificate: world.deviceCert,
        now: NOW,
      });
      expect(verdict.ok).toBe(false);
      expect(JSON.stringify(verdict)).not.toContain(MARKER);
    }
  });
});
