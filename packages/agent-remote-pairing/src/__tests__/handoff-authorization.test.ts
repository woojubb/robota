import { createIdentityContext } from '../identity/crypto-context.js';
const testIdentity = createIdentityContext('test-product');
import { describe, expect, it } from 'vitest';

import { deriveIdentityId, exportPublicKey, generateIdentityKeyPair } from '../device-identity.js';
import {
  issueHandoffGrant,
  verifyHandoffGrant,
  type IHandoffGrantClaims,
} from '../handoff-authorization.js';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const USER_ID = 'user_1';

async function aDevice() {
  const keyPair = await generateIdentityKeyPair(true);
  return {
    keyPair,
    deviceId: await deriveIdentityId(await exportPublicKey(keyPair.publicKey)),
  };
}

describe('a grant authorizes ONE transfer, to ONE destination, over ONE channel', () => {
  async function aGrant(over: Partial<IHandoffGrantClaims> = {}) {
    const source = await aDevice();
    const destination = await aDevice();
    const claims: IHandoffGrantClaims = {
      userId: USER_ID,
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
    const grant = await issueHandoffGrant(testIdentity, claims, source.keyPair.privateKey);
    return { source, destination, grant, claims };
  }

  const baseOptions = (ctx: Awaited<ReturnType<typeof aGrant>>) => ({
    sourcePublicKey: ctx.source.keyPair.publicKey,
    expectedUserId: USER_ID,
    expectedDestinationDeviceId: ctx.destination.deviceId,
    expectedHandoffId: 'handoff_1',
    expectedSessionId: 'session_1',
    observedChannelFingerprint: 'AA:BB:CC',
    now: NOW,
  });

  it('authorizes the intended transfer', async () => {
    const ctx = await aGrant();

    const result = await verifyHandoffGrant(testIdentity, ctx.grant, baseOptions(ctx));

    expect(result.authorized).toBe(true);
    expect(result.trust).toBe('same-user-different-host');
  });

  it('refuses a grant addressed to a different destination', async () => {
    const ctx = await aGrant();

    const result = await verifyHandoffGrant(testIdentity, ctx.grant, {
      ...baseOptions(ctx),
      expectedDestinationDeviceId: 'some-other-device',
    });

    expect(result.authorized).toBe(false);
    expect(result.rejection).toBe('wrong-destination');
  });

  it('refuses reuse for a different hand-off or session', async () => {
    // "Cannot be reused for another transfer" — the issue's words, asserted on both halves of the
    // audience rather than only the one that is easier to check.
    const ctx = await aGrant();

    const otherHandoff = await verifyHandoffGrant(testIdentity, ctx.grant, {
      ...baseOptions(ctx),
      expectedHandoffId: 'handoff_2',
    });
    const otherSession = await verifyHandoffGrant(testIdentity, ctx.grant, {
      ...baseOptions(ctx),
      expectedSessionId: 'session_2',
    });

    expect(otherHandoff.rejection).toBe('wrong-audience');
    expect(otherSession.rejection).toBe('wrong-audience');
  });

  it('refuses a grant presented over a substituted channel', async () => {
    const ctx = await aGrant();

    const result = await verifyHandoffGrant(testIdentity, ctx.grant, {
      ...baseOptions(ctx),
      observedChannelFingerprint: 'DD:EE:FF',
    });

    expect(result.rejection).toBe('channel-substituted');
  });

  it('refuses a replayed nonce and an expired grant', async () => {
    const ctx = await aGrant();

    const replayed = await verifyHandoffGrant(testIdentity, ctx.grant, {
      ...baseOptions(ctx),
      seenNonces: new Set(['nonce_1']),
    });
    const expired = await verifyHandoffGrant(testIdentity, ctx.grant, {
      ...baseOptions(ctx),
      now: NOW + 2 * HOUR,
    });

    expect(replayed.rejection).toBe('nonce-replayed');
    expect(expired.rejection).toBe('expired');
  });

  it('every claim is inside the signature', async () => {
    // Checked field by field rather than asserted. A binding outside the signature is a
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
        testIdentity,
        { ...ctx.grant, ...mutation },
        { ...baseOptions(ctx), observedChannelFingerprint: 'AA:BB:CC' },
      );
      expect(result.rejection, JSON.stringify(mutation)).toBe('signature-invalid');
    }
  });

  it('refuses a grant signed by a device that is not the source', async () => {
    const ctx = await aGrant();
    const impostor = await generateIdentityKeyPair(true);
    const forged = await issueHandoffGrant(testIdentity, ctx.claims, impostor.privateKey);

    const result = await verifyHandoffGrant(testIdentity, forged, baseOptions(ctx));

    expect(result.rejection).toBe('signature-invalid');
  });

  it('its trust level is NOT interchangeable with a local-peer admission', async () => {
    // These must stay distinct. A cross-device authorization must never satisfy a
    // check that wanted same-machine, or a hand-off could be authorized by a local admission.
    const ctx = await aGrant();

    const result = await verifyHandoffGrant(testIdentity, ctx.grant, baseOptions(ctx));

    expect(result.trust).toBe('same-user-different-host');
    expect(result.trust).not.toBe('same-user-same-host');
  });
});
