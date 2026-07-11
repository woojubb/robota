import {
  deriveIdentityId,
  exportPublicKey,
  generateIdentityKeyPair,
  importPublicKey,
  startDeviceReconnect,
  type TReconnectFrame,
} from '@robota-sdk/agent-remote-pairing';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';
import { describe, expect, it, vi } from 'vitest';

import { PairingGate, type IHostReconnectConfig } from '../pairing-gate.js';

/**
 * REMOTE-012 E3 TC-05 — the host gate's E3 admission paths, in isolation with a stub channel: first-pair
 * ENROLLMENT (pin the device key, expose the session) and mutual RECONNECT (admit a pinned device, deny an
 * unknown/revoked one) — all fail-closed.
 */

function stubSession(): IInteractiveSession {
  return {
    getMessages: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as IInteractiveSession;
}

/** A channel that captures sends and can route parsed frames to a sink (the counterpart controller). */
function stubChannel(sink?: (frame: unknown) => void): {
  channel: { send: (d: string) => void; close: () => void };
  sent: unknown[];
  closed: () => boolean;
} {
  const sent: unknown[] = [];
  let closed = false;
  return {
    channel: {
      send(d: string): void {
        const parsed = JSON.parse(d);
        sent.push(parsed);
        sink?.(parsed);
      },
      close(): void {
        closed = true;
      },
    },
    sent,
    closed: () => closed,
  };
}

const FP = { localFingerprint: 'HOST:FP', remoteFingerprint: 'DEV:FP' };

async function hostConfig(over: Partial<IHostReconnectConfig> = {}): Promise<{
  cfg: IHostReconnectConfig;
  hostKeyPair: CryptoKeyPair;
}> {
  const hostKeyPair = await generateIdentityKeyPair(true);
  const hostPublicSpki = await exportPublicKey(hostKeyPair.publicKey);
  return {
    hostKeyPair,
    cfg: {
      hostIdentityId: await deriveIdentityId(hostPublicSpki),
      hostPublicSpki,
      hostPrivateKey: hostKeyPair.privateKey,
      resolveDevicePublicKey: async () => undefined,
      onEnroll: vi.fn(),
      ...over,
    },
  };
}

describe('PairingGate E3 first-pair enrollment (REMOTE-012 TC-05)', () => {
  it('after B3 accept, advertises the host key, pins the device key, and exposes the session', async () => {
    const { cfg } = await hostConfig();
    const onAccept = vi.fn();
    // Fake handshake that accepts immediately (isolates the enrollment path from real B3 crypto).
    const fakeHandshake = (() => ({
      result: Promise.resolve({ sessionKey: 'k' }),
      onFrame: () => {},
    })) as never;

    const { channel, sent } = stubChannel();
    const gate = new PairingGate({
      channel,
      session: stubSession(),
      secret: 's',
      role: 'initiator',
      ...FP,
      reconnect: cfg,
      onAccept,
      startHandshake: fakeHandshake,
    });

    // Client opens first-pair mode.
    gate.onInbound(JSON.stringify({ t: 'pair-nonce', nonce: 'n' }));
    await Promise.resolve();
    await Promise.resolve();
    // Host advertised its identity key.
    expect(sent.some((f) => (f as { t?: string }).t === 'enroll-key')).toBe(true);

    // Device replies with its public key → host pins it and exposes the session.
    const deviceKey = await generateIdentityKeyPair(false);
    const deviceSpki = await exportPublicKey(deviceKey.publicKey);
    gate.onInbound(JSON.stringify({ t: 'enroll-key', spki: deviceSpki }));
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(cfg.onEnroll).toHaveBeenCalledWith(await deriveIdentityId(deviceSpki), deviceSpki);
  });
});

describe('PairingGate E3 reconnect (REMOTE-012 TC-05)', () => {
  async function pinnedDevice(): Promise<{
    keyPair: CryptoKeyPair;
    deviceId: string;
    publicKey: CryptoKey;
  }> {
    const keyPair = await generateIdentityKeyPair(false);
    const spki = await exportPublicKey(keyPair.publicKey);
    return {
      keyPair,
      deviceId: await deriveIdentityId(spki),
      publicKey: await importPublicKey(spki),
    };
  }

  it('admits a pinned device via mutual reconnect and exposes the session (no re-enroll)', async () => {
    const device = await pinnedDevice();
    const { cfg, hostKeyPair } = await hostConfig({
      resolveDevicePublicKey: async (id) => (id === device.deviceId ? device.publicKey : undefined),
    });
    const hostPublicKey = await importPublicKey(cfg.hostPublicSpki);
    const onAccept = vi.fn();
    const onReject = vi.fn();

    let gate!: PairingGate;
    let deviceCtrl!: ReturnType<typeof startDeviceReconnect>;
    // Route host→device frames into the device controller.
    const { channel } = stubChannel((frame) => deviceCtrl.onFrame(frame as TReconnectFrame));
    gate = new PairingGate({
      channel,
      session: stubSession(),
      secret: 's',
      role: 'initiator',
      ...FP,
      reconnect: cfg,
      onAccept,
      onReject,
    });
    // Device drives the reconnect; its frames go into the gate.
    deviceCtrl = startDeviceReconnect({
      deviceId: device.deviceId,
      hostIdentityId: cfg.hostIdentityId,
      localFingerprint: FP.remoteFingerprint,
      remoteFingerprint: FP.localFingerprint,
      devicePrivateKey: device.keyPair.privateKey,
      pinnedHostPublicKey: hostPublicKey,
      send: (frame) => gate.onInbound(JSON.stringify(frame)),
      timeoutMs: 1000,
    });

    await deviceCtrl.result;
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(onReject).not.toHaveBeenCalled();
    expect(cfg.onEnroll).not.toHaveBeenCalled();
  });

  it('fail-closed: an unknown/revoked device is denied (channel closed, no session)', async () => {
    const { cfg } = await hostConfig({ resolveDevicePublicKey: async () => undefined });
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { channel, closed } = stubChannel();
    const gate = new PairingGate({
      channel,
      session: stubSession(),
      secret: 's',
      role: 'initiator',
      ...FP,
      reconnect: cfg,
      onAccept,
      onReject,
    });
    gate.onInbound(JSON.stringify({ t: 'rc-hello', deviceId: 'ghost', nonceDevice: 'ZGV2' }));
    await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(onAccept).not.toHaveBeenCalled();
    expect(closed()).toBe(true);
  });
});
