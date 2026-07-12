import {
  deriveIdentityId,
  exportPublicKey,
  generateIdentityKeyPair,
  importPublicKey,
  startHostReconnect,
  type TReconnectFrame,
} from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it, vi } from 'vitest';

import { ResponderGate, type IDeviceIdentityConfig } from '../rtc-responder-gate.js';

/**
 * REMOTE-012 E3 — the browser ResponderGate E3 paths: first-pair ENROLLMENT (pin the host key, advertise the
 * device key, expose) and client-initiated RECONNECT (verify the host against the pinned key, fail-closed on
 * a rogue host).
 */

const FP = { localFingerprint: 'DEV:FP', remoteFingerprint: 'HOST:FP' };

function stubChannel(sink?: (f: unknown) => void): {
  channel: { send: (d: string) => void; close: () => void };
  sent: unknown[];
  closed: () => boolean;
} {
  const sent: unknown[] = [];
  let closed = false;
  return {
    channel: {
      send(d: string): void {
        const p = JSON.parse(d);
        sent.push(p);
        sink?.(p);
      },
      close(): void {
        closed = true;
      },
    },
    sent,
    closed: () => closed,
  };
}

async function deviceIdentity(
  over: Partial<IDeviceIdentityConfig> = {},
): Promise<IDeviceIdentityConfig> {
  const deviceKeyPair = await generateIdentityKeyPair(false);
  const devicePublicSpki = await exportPublicKey(deviceKeyPair.publicKey);
  return {
    deviceKeyPair,
    deviceId: await deriveIdentityId(devicePublicSpki),
    devicePublicSpki,
    onEnrollHost: vi.fn(),
    ...over,
  };
}

describe('ResponderGate E3 first-pair enrollment (REMOTE-012)', () => {
  it('after B3 accept, pins the host key, advertises the device key, and exposes the session', async () => {
    const identity = await deviceIdentity();
    const onAccept = vi.fn();
    const fakeHandshake = (() => ({
      result: Promise.resolve({ sessionKey: 'k' }),
      onFrame: () => {},
    })) as never;
    const { channel, sent } = stubChannel();

    const gate = new ResponderGate({
      channel,
      secret: 's',
      ...FP,
      onMessage: vi.fn(),
      onAccept,
      deviceIdentity: identity,
      startHandshake: fakeHandshake,
    });

    // Drive B3 to accept (fake handshake already resolved) then the host advertises its key.
    gate.onInbound(JSON.stringify({ t: 'pair-nonce', nonce: 'n' }));
    await Promise.resolve();
    const hostKey = await generateIdentityKeyPair(true);
    const hostSpki = await exportPublicKey(hostKey.publicKey);
    gate.onInbound(JSON.stringify({ t: 'enroll-key', spki: hostSpki }));

    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(identity.onEnrollHost).toHaveBeenCalledWith(hostSpki, expect.anything()); // (hostSpki, sessionKey)
    expect(sent.some((f) => (f as { t?: string }).t === 'enroll-key')).toBe(true);
  });
});

describe('ResponderGate E3 reconnect (REMOTE-012)', () => {
  it('verifies the host and exposes the session against a matching host reconnect controller', async () => {
    const hostKey = await generateIdentityKeyPair(true);
    const hostSpki = await exportPublicKey(hostKey.publicKey);
    const hostIdentityId = await deriveIdentityId(hostSpki);
    const identity = await deviceIdentity({
      reconnect: { hostIdentityId, pinnedHostPublicKey: await importPublicKey(hostSpki) },
    });
    const devicePub = await importPublicKey(identity.devicePublicSpki);

    // The device (gate) initiates reconnect in its constructor, so the host controller must exist FIRST.
    let gate!: ResponderGate;
    const hostCtrl = startHostReconnect({
      hostIdentityId,
      localFingerprint: FP.remoteFingerprint,
      remoteFingerprint: FP.localFingerprint,
      hostPrivateKey: hostKey.privateKey,
      resolveDevicePublicKey: async (id) => (id === identity.deviceId ? devicePub : undefined),
      send: (frame) => gate.onInbound(JSON.stringify(frame)),
      timeoutMs: 1000,
    });
    const { channel } = stubChannel((frame) => hostCtrl.onFrame(frame as TReconnectFrame));
    const onAccept = vi.fn();
    gate = new ResponderGate({
      channel,
      secret: 's',
      ...FP,
      onMessage: vi.fn(),
      onAccept,
      deviceIdentity: identity,
    });

    await hostCtrl.result;
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
  });

  it('fail-closed: a rogue host (wrong pinned key) → the device rejects and closes', async () => {
    const realHost = await generateIdentityKeyPair(true);
    const rogue = await generateIdentityKeyPair(true);
    const hostSpki = await exportPublicKey(realHost.publicKey);
    const hostIdentityId = await deriveIdentityId(hostSpki);
    // Device pinned the ROGUE key, but the real host signs — device verify fails.
    const identity = await deviceIdentity({
      reconnect: {
        hostIdentityId,
        pinnedHostPublicKey: await importPublicKey(await exportPublicKey(rogue.publicKey)),
      },
    });
    const devicePub = await importPublicKey(identity.devicePublicSpki);

    let gate!: ResponderGate;
    const hostCtrl = startHostReconnect({
      hostIdentityId,
      localFingerprint: FP.remoteFingerprint,
      remoteFingerprint: FP.localFingerprint,
      hostPrivateKey: realHost.privateKey,
      resolveDevicePublicKey: async () => devicePub,
      send: (frame) => gate.onInbound(JSON.stringify(frame)),
      timeoutMs: 1000,
    });
    const { channel, closed } = stubChannel((frame) => hostCtrl.onFrame(frame as TReconnectFrame));
    const onReject = vi.fn();
    gate = new ResponderGate({
      channel,
      secret: 's',
      ...FP,
      onMessage: vi.fn(),
      onReject,
      deviceIdentity: identity,
    });

    await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(closed()).toBe(true);
  });
});
