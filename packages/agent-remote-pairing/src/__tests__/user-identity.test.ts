import { describe, expect, it } from 'vitest';

import { deriveIdentityId, exportPublicKey, generateIdentityKeyPair } from '../device-identity.js';
import {
  issueHandoffGrant,
  verifyHandoffGrant,
  type IHandoffGrantClaims,
} from '../handoff-authorization.js';
import {
  deriveUserId,
  generateUserRootKeyPair,
  issueDeviceCertificate,
  verifyDeviceCertificate,
  verifyDevicePossession,
} from '../user-identity.js';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

async function aUser() {
  const root = await generateUserRootKeyPair(true);
  const userId = await deriveUserId(root.publicKey);
  return { root, userId };
}

async function aDevice(user: { root: CryptoKeyPair; userId: string }) {
  const keyPair = await generateIdentityKeyPair(true);
  const certificate = await issueDeviceCertificate({
    rootPrivateKey: user.root.privateKey,
    userId: user.userId,
    devicePublicKey: keyPair.publicKey,
    issuedAt: NOW,
    expiresAt: NOW + HOUR,
  });
  return {
    keyPair,
    certificate,
    deviceId: await deriveIdentityId(await exportPublicKey(keyPair.publicKey)),
  };
}

describe('SEC-011 — same user, proven by the destination rather than asserted by the source', () => {
  it('TC-01: two devices signed by one root verify against that user', async () => {
    const user = await aUser();
    const source = await aDevice(user);
    const destination = await aDevice(user);

    for (const device of [source, destination]) {
      const result = await verifyDeviceCertificate(device.certificate, {
        rootPublicKey: user.root.publicKey,
        expectedUserId: user.userId,
        now: NOW,
      });
      expect(result.valid).toBe(true);
      expect(result.deviceId).toBe(device.deviceId);
    }
  });

  it('TC-02: a device signed by a DIFFERENT root is a different person', async () => {
    // The core rejection. Without it, any device with any certificate could receive a hand-off.
    const mine = await aUser();
    const theirs = await aUser();
    const theirDevice = await aDevice(theirs);

    const result = await verifyDeviceCertificate(theirDevice.certificate, {
      rootPublicKey: mine.root.publicKey,
      expectedUserId: mine.userId,
      now: NOW,
    });

    expect(result.valid).toBe(false);
    expect(result.rejection).toBe('signature-invalid');
  });

  it('TC-06: every signed field is covered — tampering any of them invalidates', async () => {
    // A signature over a subset would leave the omitted field attacker-editable while still
    // verifying, which reads as a valid certificate. Checked field by field rather than asserted.
    const user = await aUser();
    const device = await aDevice(user);
    const mutations = [
      { userId: 'someone-else' },
      { deviceId: 'another-device' },
      { issuedAt: NOW - HOUR },
      { expiresAt: NOW + 10 * HOUR },
    ];

    for (const mutation of mutations) {
      const result = await verifyDeviceCertificate(
        { ...device.certificate, ...mutation },
        { rootPublicKey: user.root.publicKey, expectedUserId: user.userId, now: NOW },
      );
      expect(result.rejection, JSON.stringify(mutation)).toBe('signature-invalid');
    }
  });

  it('TC-05: an expired certificate is refused however intact its signature', async () => {
    const user = await aUser();
    const device = await aDevice(user);

    const expired = await verifyDeviceCertificate(device.certificate, {
      rootPublicKey: user.root.publicKey,
      expectedUserId: user.userId,
      now: NOW + 2 * HOUR,
    });
    const early = await verifyDeviceCertificate(device.certificate, {
      rootPublicKey: user.root.publicKey,
      expectedUserId: user.userId,
      now: NOW - 1,
    });

    expect(expired.rejection).toBe('expired');
    expect(early.rejection).toBe('not-yet-valid');
  });

  it('TC-08: a revoked device fails with an intact signature', async () => {
    // Revocation must not depend on the certificate changing — a retired device still holds a
    // perfectly valid one, which is exactly why revocation exists.
    const user = await aUser();
    const device = await aDevice(user);

    const result = await verifyDeviceCertificate(device.certificate, {
      rootPublicKey: user.root.publicKey,
      expectedUserId: user.userId,
      now: NOW,
      revokedDeviceIds: [device.deviceId],
    });

    expect(result.valid).toBe(false);
    expect(result.rejection).toBe('revoked');
  });

  it('a certificate alone proves nothing about who presents it', async () => {
    // A certificate is a public document. Possession of the device key is a SEPARATE step, and the
    // two are separate calls so neither looks complete on its own.
    const user = await aUser();
    const device = await aDevice(user);
    const impostor = await generateIdentityKeyPair(true);
    const challenge = new TextEncoder().encode('challenge-bytes');

    const realSignature = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        device.keyPair.privateKey,
        challenge as unknown as ArrayBuffer,
      ),
    );
    const impostorSignature = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        impostor.privateKey,
        challenge as unknown as ArrayBuffer,
      ),
    );

    expect(await verifyDevicePossession(device.certificate, challenge, realSignature)).toBe(true);
    expect(await verifyDevicePossession(device.certificate, challenge, impostorSignature)).toBe(
      false,
    );
  });
});

describe('SEC-011 — a grant authorizes ONE transfer, to ONE destination, over ONE channel', () => {
  async function aGrant(over: Partial<IHandoffGrantClaims> = {}) {
    const user = await aUser();
    const source = await aDevice(user);
    const destination = await aDevice(user);
    const claims: IHandoffGrantClaims = {
      userId: user.userId,
      sourceDeviceId: source.deviceId,
      destinationDeviceId: destination.deviceId,
      handoffId: 'handoff_1',
      sessionId: 'session_1',
      nonce: 'nonce_1',
      channelFingerprint: 'AA:BB:CC',
      issuedAt: NOW,
      expiresAt: NOW + HOUR,
      ...over,
    };
    const grant = await issueHandoffGrant(claims, source.keyPair.privateKey);
    return { user, source, destination, grant, claims };
  }

  const baseOptions = (ctx: Awaited<ReturnType<typeof aGrant>>) => ({
    sourcePublicKey: ctx.source.keyPair.publicKey,
    expectedUserId: ctx.user.userId,
    expectedDestinationDeviceId: ctx.destination.deviceId,
    expectedHandoffId: 'handoff_1',
    expectedSessionId: 'session_1',
    observedChannelFingerprint: 'AA:BB:CC',
    now: NOW,
  });

  it('authorizes the intended transfer', async () => {
    const ctx = await aGrant();

    const result = await verifyHandoffGrant(ctx.grant, baseOptions(ctx));

    expect(result.authorized).toBe(true);
    expect(result.trust).toBe('same-user-different-host');
  });

  it('TC-03: refuses a grant addressed to a different destination', async () => {
    const ctx = await aGrant();

    const result = await verifyHandoffGrant(ctx.grant, {
      ...baseOptions(ctx),
      expectedDestinationDeviceId: 'some-other-device',
    });

    expect(result.authorized).toBe(false);
    expect(result.rejection).toBe('wrong-destination');
  });

  it('TC-04: refuses reuse for a different hand-off or session', async () => {
    // "Cannot be reused for another transfer" — the issue's words, asserted on both halves of the
    // audience rather than only the one that is easier to check.
    const ctx = await aGrant();

    const otherHandoff = await verifyHandoffGrant(ctx.grant, {
      ...baseOptions(ctx),
      expectedHandoffId: 'handoff_2',
    });
    const otherSession = await verifyHandoffGrant(ctx.grant, {
      ...baseOptions(ctx),
      expectedSessionId: 'session_2',
    });

    expect(otherHandoff.rejection).toBe('wrong-audience');
    expect(otherSession.rejection).toBe('wrong-audience');
  });

  it('TC-07: refuses a grant presented over a substituted channel', async () => {
    const ctx = await aGrant();

    const result = await verifyHandoffGrant(ctx.grant, {
      ...baseOptions(ctx),
      observedChannelFingerprint: 'DD:EE:FF',
    });

    expect(result.rejection).toBe('channel-substituted');
  });

  it('TC-05: refuses a replayed nonce and an expired grant', async () => {
    const ctx = await aGrant();

    const replayed = await verifyHandoffGrant(ctx.grant, {
      ...baseOptions(ctx),
      seenNonces: new Set(['nonce_1']),
    });
    const expired = await verifyHandoffGrant(ctx.grant, {
      ...baseOptions(ctx),
      now: NOW + 2 * HOUR,
    });

    expect(replayed.rejection).toBe('nonce-replayed');
    expect(expired.rejection).toBe('expired');
  });

  it('TC-06: every claim is inside the signature', async () => {
    // The same field-by-field proof as for certificates. A binding outside the signature is a
    // binding an attacker can edit while the signature still verifies.
    const ctx = await aGrant();
    const mutations: Partial<IHandoffGrantClaims>[] = [
      { userId: 'other-user' },
      { sourceDeviceId: 'other-source' },
      { destinationDeviceId: 'other-destination' },
      { handoffId: 'handoff_2' },
      { sessionId: 'session_2' },
      { nonce: 'nonce_2' },
      { channelFingerprint: 'DD:EE:FF' },
      { issuedAt: NOW - HOUR },
      { expiresAt: NOW + 10 * HOUR },
    ];

    for (const mutation of mutations) {
      const result = await verifyHandoffGrant(
        { ...ctx.grant, ...mutation },
        { ...baseOptions(ctx), observedChannelFingerprint: 'AA:BB:CC' },
      );
      expect(result.rejection, JSON.stringify(mutation)).toBe('signature-invalid');
    }
  });

  it('TC-02: refuses a grant signed by a device that is not the source', async () => {
    const ctx = await aGrant();
    const impostor = await generateIdentityKeyPair(true);
    const forged = await issueHandoffGrant(ctx.claims, impostor.privateKey);

    const result = await verifyHandoffGrant(forged, baseOptions(ctx));

    expect(result.rejection).toBe('signature-invalid');
  });

  it('TC-10: its trust level is NOT interchangeable with SEC-010’s local admission', async () => {
    // The issue requires these to stay distinct. A cross-device authorization must never satisfy a
    // check that wanted same-machine, or a hand-off could be authorized by a local admission.
    const ctx = await aGrant();

    const result = await verifyHandoffGrant(ctx.grant, baseOptions(ctx));

    expect(result.trust).toBe('same-user-different-host');
    expect(result.trust).not.toBe('same-user-same-host');
  });
});
