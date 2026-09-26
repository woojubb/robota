import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import {
  deriveIdentityId,
  exportPublicKey,
  generateIdentityKeyPair,
  importPublicKey,
  startDeviceReconnect,
  type TReconnectFrame,
} from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it, vi } from 'vitest';

import { nextAdmissionStep } from '../admission-steps.js';
import {
  PairingGate,
  type IConnectionApproval,
  type IConnectionApprovalContext,
  type IHostReconnectConfig,
  type IPairingGateOptions,
} from '../pairing-gate.js';

import type { createSessionMessageHandler } from '@robota-sdk/agent-transport';

/**
 * A connection that would drive the session is the receiving operator's to allow, every time: the
 * handshake proves who is on the other end, and the operator decides whether that device drives now.
 * Until they say yes nothing reaches the session, and a device they refuse is not remembered.
 */

const FP = { localFingerprint: 'HOST:FP', remoteFingerprint: 'DEV:FP' };

function deferred(): { promise: Promise<boolean>; resolve: (value: boolean) => void } {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeGate(over: Partial<IPairingGateOptions> = {}) {
  const sent: unknown[] = [];
  let closed = false;
  const channel = {
    send: (d: string) => {
      sent.push(JSON.parse(d));
    },
    close: () => {
      closed = true;
    },
  };
  const sessionOnMessage = vi.fn();
  const createHandler: typeof createSessionMessageHandler = () => ({
    onMessage: sessionOnMessage,
    cleanup: vi.fn(),
  });
  const onAccept = vi.fn();
  const onReject = vi.fn();
  const fakeHandshake = (() => ({
    result: Promise.resolve({ sessionKey: 'k' }),
    onFrame: () => {},
  })) as never;
  const gate = new PairingGate({
    channel,
    session: createTestInteractiveSession(),
    secret: 's',
    role: 'initiator',
    ...FP,
    startHandshake: fakeHandshake,
    createHandler,
    onAccept,
    onReject,
    ...over,
  });
  return { gate, sent, closed: () => closed, sessionOnMessage, onAccept, onReject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('operator approval of a driving connection', () => {
  it('is the last step owed, after every proof the channel owes', () => {
    const configured = { localPeer: {}, handoffGrant: {}, connectionApproval: {} };
    expect(nextAdmissionStep({ connectionApproval: {} }, 'pairing')).toBe('operator-approval');
    expect(nextAdmissionStep(configured, 'pairing')).toBe('local-proof');
    expect(nextAdmissionStep(configured, 'local-proof')).toBe('handoff-grant');
    expect(nextAdmissionStep(configured, 'handoff-grant')).toBe('operator-approval');
    expect(nextAdmissionStep(configured, 'operator-approval')).toBe(null);
  });

  it('exposes nothing while the operator has not answered', async () => {
    const answer = deferred();
    const approve = vi.fn(() => answer.promise);
    const { gate, sessionOnMessage, onAccept } = makeGate({ connectionApproval: { approve } });
    await flush();
    expect(approve).toHaveBeenCalledTimes(1);
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));
    expect(sessionOnMessage).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();

    answer.resolve(true);
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    // What the peer said while waiting reaches the session only now, in order, then live frames.
    expect(sessionOnMessage).toHaveBeenCalledTimes(1);
    gate.onInbound(JSON.stringify({ type: 'get-messages' }));
    expect(sessionOnMessage.mock.calls.map(([frame]) => JSON.parse(frame as string).type)).toEqual([
      'submit',
      'get-messages',
    ]);
  });

  it('drops what the peer said while waiting when the operator refuses', async () => {
    const answer = deferred();
    const { gate, sessionOnMessage, onReject } = makeGate({
      connectionApproval: { approve: () => answer.promise },
    });
    await flush();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));
    answer.resolve(false);
    await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('withdraws the question and admits nothing when the channel closes while the operator decides', async () => {
    const answer = deferred();
    let signal: AbortSignal | undefined;
    const approve = vi.fn((context: IConnectionApprovalContext) => {
      signal = context.signal;
      return answer.promise;
    });
    const { gate, sessionOnMessage, onAccept, onReject } = makeGate({
      connectionApproval: { approve },
    });
    await flush();
    gate.onInbound(JSON.stringify({ type: 'get-messages' }));
    expect(signal?.aborted).toBe(false);

    gate.onChannelClosed();
    expect(signal?.aborted).toBe(true);
    expect(onReject).toHaveBeenCalledTimes(1);

    answer.resolve(true);
    await flush();
    expect(onAccept).not.toHaveBeenCalled();
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('does not pin an enrolling device whose channel closed while the operator decided', async () => {
    const cfg = await hostConfig();
    const answer = deferred();
    const approve = vi.fn(() => answer.promise);
    const { gate, onAccept } = makeGate({ reconnect: cfg, connectionApproval: { approve } });
    gate.onInbound(JSON.stringify({ t: 'pair-nonce', nonce: 'n' }));
    await flush();
    const deviceKey = await generateIdentityKeyPair(false);
    gate.onInbound(
      JSON.stringify({ t: 'enroll-key', spki: await exportPublicKey(deviceKey.publicKey) }),
    );
    await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    gate.onChannelClosed();
    answer.resolve(true);
    await flush();
    expect(cfg.onEnroll).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('an accepted channel closing is the transport’s drop, not a refusal', async () => {
    const { gate, onAccept, onReject } = makeGate({
      connectionApproval: { approve: async () => true },
    });
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    gate.onChannelClosed();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('refuses a peer that floods the channel while the operator decides', async () => {
    const answer = deferred();
    const { gate, closed, onReject, sessionOnMessage } = makeGate({
      connectionApproval: { approve: () => answer.promise },
    });
    await flush();
    for (let i = 0; i < 100; i += 1) gate.onInbound(JSON.stringify({ type: 'get-messages' }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(closed()).toBe(true);
    answer.resolve(true);
    await flush();
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('refuses the connection the operator declines: closed, and the session never reached', async () => {
    const { gate, closed, sessionOnMessage, onAccept, onReject } = makeGate({
      connectionApproval: { approve: async () => false },
    });
    await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(closed()).toBe(true);
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));
    expect(sessionOnMessage).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('refuses when asking the operator fails', async () => {
    const { closed, onAccept, onReject } = makeGate({
      connectionApproval: { approve: () => Promise.reject(new Error('no terminal')) },
    });
    await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(closed()).toBe(true);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('does not accept an answer that arrives after the channel was torn down', async () => {
    const answer = deferred();
    const { gate, sessionOnMessage, onAccept } = makeGate({
      connectionApproval: { approve: () => answer.promise },
    });
    await flush();
    gate.cleanup();
    answer.resolve(true);
    await flush();
    expect(onAccept).not.toHaveBeenCalled();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });
});

async function hostConfig(over: Partial<IHostReconnectConfig> = {}): Promise<IHostReconnectConfig> {
  const hostKeyPair = await generateIdentityKeyPair(true);
  const hostPublicSpki = await exportPublicKey(hostKeyPair.publicKey);
  return {
    hostIdentityId: await deriveIdentityId(hostPublicSpki),
    hostPublicSpki,
    hostPrivateKey: hostKeyPair.privateKey,
    resolveDevicePublicKey: async () => undefined,
    onEnroll: vi.fn(),
    ...over,
  };
}

describe('operator approval with trusted-device enrollment', () => {
  async function enrollingGate(approval: IConnectionApproval) {
    const cfg = await hostConfig();
    const made = makeGate({ reconnect: cfg, connectionApproval: approval });
    made.gate.onInbound(JSON.stringify({ t: 'pair-nonce', nonce: 'n' }));
    await flush();
    const deviceKey = await generateIdentityKeyPair(false);
    const deviceSpki = await exportPublicKey(deviceKey.publicKey);
    made.gate.onInbound(JSON.stringify({ t: 'enroll-key', spki: deviceSpki }));
    return { ...made, cfg, deviceSpki, deviceId: await deriveIdentityId(deviceSpki) };
  }

  it('asks about the device that enrolled, and pins it only once the operator allows it', async () => {
    const approve = vi.fn(async () => true);
    const { cfg, onAccept, deviceId, deviceSpki } = await enrollingGate({ approve });
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId, viaReconnect: false }),
    );
    expect(cfg.onEnroll).toHaveBeenCalledWith(deviceId, deviceSpki);
  });

  it('does not pin a device the operator refuses', async () => {
    const { cfg, onReject } = await enrollingGate({ approve: async () => false });
    await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(cfg.onEnroll).not.toHaveBeenCalled();
  });

  it('asks again when a trusted device reconnects, naming it', async () => {
    const keyPair = await generateIdentityKeyPair(false);
    const spki = await exportPublicKey(keyPair.publicKey);
    const deviceId = await deriveIdentityId(spki);
    const publicKey = await importPublicKey(spki);
    const cfg = await hostConfig({
      resolveDevicePublicKey: async (id) => (id === deviceId ? publicKey : undefined),
    });
    const approve = vi.fn(async () => false);
    let deviceCtrl!: ReturnType<typeof startDeviceReconnect>;
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const gate = new PairingGate({
      channel: {
        send: (d: string) => deviceCtrl.onFrame(JSON.parse(d) as TReconnectFrame),
        close: () => {},
      },
      session: createTestInteractiveSession(),
      secret: 's',
      role: 'initiator',
      ...FP,
      reconnect: cfg,
      connectionApproval: { approve },
      onAccept,
      onReject,
    });
    deviceCtrl = startDeviceReconnect({
      deviceId,
      hostIdentityId: cfg.hostIdentityId,
      localFingerprint: FP.remoteFingerprint,
      remoteFingerprint: FP.localFingerprint,
      devicePrivateKey: keyPair.privateKey,
      pinnedHostPublicKey: await importPublicKey(cfg.hostPublicSpki),
      send: (frame) => gate.onInbound(JSON.stringify(frame)),
      timeoutMs: 1000,
    });
    await deviceCtrl.result;
    await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ deviceId, viaReconnect: true }));
    expect(onAccept).not.toHaveBeenCalled();
  });
});
