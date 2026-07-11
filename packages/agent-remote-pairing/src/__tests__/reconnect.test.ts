import { describe, expect, it } from 'vitest';

import {
  deriveIdentityId,
  exportPublicKey,
  generateIdentityKeyPair,
  importPublicKey,
} from '../device-identity.js';
import { startDeviceReconnect, startHostReconnect, type TReconnectFrame } from '../reconnect.js';

/**
 * REMOTE-012 E3 TC-03 — the MUTUAL reconnect controller: both sides authenticate before accept. Wires a
 * device controller and a host controller in-memory and asserts mutual accept + fail-closed on a rogue host,
 * an unknown device, and a tampered device proof.
 */

interface IHarness {
  hostKeyPair: CryptoKeyPair;
  deviceKeyPair: CryptoKeyPair;
  hostIdentityId: string;
  deviceId: string;
  pinnedHostPublicKey: CryptoKey;
  devicePublicKey: CryptoKey;
}

async function setup(): Promise<IHarness> {
  const hostKeyPair = await generateIdentityKeyPair(false);
  const deviceKeyPair = await generateIdentityKeyPair(false);
  const hostSpki = await exportPublicKey(hostKeyPair.publicKey);
  const deviceSpki = await exportPublicKey(deviceKeyPair.publicKey);
  return {
    hostKeyPair,
    deviceKeyPair,
    hostIdentityId: await deriveIdentityId(hostSpki),
    deviceId: await deriveIdentityId(deviceSpki),
    pinnedHostPublicKey: await importPublicKey(hostSpki),
    devicePublicKey: await importPublicKey(deviceSpki),
  };
}

/** Fingerprints as each side observes them (local/remote swapped) — sortedPair collapses them to one binding. */
const HOST_FP = { localFingerprint: 'HOST:FP', remoteFingerprint: 'DEVICE:FP' };
const DEVICE_FP = { localFingerprint: 'DEVICE:FP', remoteFingerprint: 'HOST:FP' };

function connect(
  h: IHarness,
  opts: {
    resolveDevice?: (id: string) => Promise<CryptoKey | undefined>;
    pinnedHostPublicKey?: CryptoKey;
  } = {},
): {
  host: ReturnType<typeof startHostReconnect>;
  device: ReturnType<typeof startDeviceReconnect>;
} {
  let host!: ReturnType<typeof startHostReconnect>;
  let device!: ReturnType<typeof startDeviceReconnect>;
  const toHost = (f: TReconnectFrame): void => host.onFrame(f);
  const toDevice = (f: TReconnectFrame): void => device.onFrame(f);

  host = startHostReconnect({
    hostIdentityId: h.hostIdentityId,
    ...HOST_FP,
    hostPrivateKey: h.hostKeyPair.privateKey,
    resolveDevicePublicKey:
      opts.resolveDevice ?? (async (id) => (id === h.deviceId ? h.devicePublicKey : undefined)),
    send: toDevice,
    timeoutMs: 1000,
  });
  device = startDeviceReconnect({
    deviceId: h.deviceId,
    hostIdentityId: h.hostIdentityId,
    ...DEVICE_FP,
    devicePrivateKey: h.deviceKeyPair.privateKey,
    pinnedHostPublicKey: opts.pinnedHostPublicKey ?? h.pinnedHostPublicKey,
    send: toHost,
    timeoutMs: 1000,
  });
  return { host, device };
}

describe('mutual reconnect (REMOTE-012 TC-03)', () => {
  it('both sides accept when the device is pinned and the host key matches', async () => {
    const h = await setup();
    const { host, device } = connect(h);
    const [hr, dr] = await Promise.all([host.result, device.result]);
    expect(hr.deviceId).toBe(h.deviceId);
    expect(dr.deviceId).toBe(h.deviceId);
  });

  it('fail-closed: a rogue host (device pinned a different host key) → device rejects', async () => {
    const h = await setup();
    const wrongHost = await generateIdentityKeyPair(false);
    const wrongPinned = await importPublicKey(await exportPublicKey(wrongHost.publicKey));
    const { device } = connect(h, { pinnedHostPublicKey: wrongPinned });
    await expect(device.result).rejects.toThrow(/host authentication failed|rogue host/i);
  });

  it('fail-closed: an unknown/revoked device (resolver returns undefined) → host rejects', async () => {
    const h = await setup();
    const { host } = connect(h, { resolveDevice: async () => undefined });
    await expect(host.result).rejects.toThrow(/unknown or revoked/i);
  });

  it('fail-closed: a tampered device proof → host rejects', async () => {
    const h = await setup();
    // Host resolves a DIFFERENT device public key than the one actually signing → device proof fails verify.
    const other = await generateIdentityKeyPair(false);
    const otherPub = await importPublicKey(await exportPublicKey(other.publicKey));
    const { host } = connect(h, { resolveDevice: async () => otherPub });
    await expect(host.result).rejects.toThrow(/device authentication failed/i);
  });

  it('fail-closed: a captured rc-device proof replayed against a fresh challenge is rejected', async () => {
    const h = await setup();
    // Capture a valid rc-device proof from a completed handshake.
    const captured: TReconnectFrame[] = [];
    let host1!: ReturnType<typeof startHostReconnect>;
    let device1!: ReturnType<typeof startDeviceReconnect>;
    host1 = startHostReconnect({
      hostIdentityId: h.hostIdentityId,
      ...HOST_FP,
      hostPrivateKey: h.hostKeyPair.privateKey,
      resolveDevicePublicKey: async () => h.devicePublicKey,
      send: (f) => device1.onFrame(f),
      timeoutMs: 1000,
    });
    device1 = startDeviceReconnect({
      deviceId: h.deviceId,
      hostIdentityId: h.hostIdentityId,
      ...DEVICE_FP,
      devicePrivateKey: h.deviceKeyPair.privateKey,
      pinnedHostPublicKey: h.pinnedHostPublicKey,
      send: (f) => {
        if (f.t === 'rc-device') captured.push(f);
        host1.onFrame(f);
      },
      timeoutMs: 1000,
    });
    await Promise.all([host1.result, device1.result]);
    const staleProof = captured[0];
    expect(staleProof?.t).toBe('rc-device');

    // A fresh host handshake issues a new nonce; replaying the stale proof must fail its verify.
    const host2 = startHostReconnect({
      hostIdentityId: h.hostIdentityId,
      ...HOST_FP,
      hostPrivateKey: h.hostKeyPair.privateKey,
      resolveDevicePublicKey: async () => h.devicePublicKey,
      send: () => {}, // swallow rc-host; we inject the stale proof directly
      timeoutMs: 200,
    });
    host2.onFrame({ t: 'rc-hello', deviceId: h.deviceId, nonceDevice: 'ZnJlc2g' });
    // Let the host process rc-hello (resolve key + sign + set pending) before the stale proof arrives.
    await new Promise((r) => setTimeout(r, 10));
    host2.onFrame(staleProof);
    // Any fail-closed rejection is acceptable — the stale proof must never authenticate.
    await expect(host2.result).rejects.toThrow();
  });

  it('fail-closed: times out if the counterpart never answers', async () => {
    const h = await setup();
    const device = startDeviceReconnect({
      deviceId: h.deviceId,
      hostIdentityId: h.hostIdentityId,
      ...DEVICE_FP,
      devicePrivateKey: h.deviceKeyPair.privateKey,
      pinnedHostPublicKey: h.pinnedHostPublicKey,
      send: () => {}, // black hole — no host
      timeoutMs: 50,
    });
    await expect(device.result).rejects.toThrow(/timed out/i);
  });
});
