import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import {
  deriveIdentityId,
  exportPublicKey,
  generateIdentityKeyPair,
  startPairingHandshake,
} from '@robota-sdk/agent-remote-pairing';
import type { IPairingResult, TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { SessionResumeBridge } from '@robota-sdk/agent-transport';
import type { ICapabilityApprovalRequest } from '@robota-sdk/agent-interface-session-mobility';
import { createInMemorySignalingPair, WebRtcTransport } from '@robota-sdk/agent-transport-webrtc';
import type { IDataChannelModule } from '@robota-sdk/agent-transport-webrtc';
import { describe, expect, it, vi } from 'vitest';

import { RemoteControlController } from '../remote-control-controller.js';
import type { ITrustedDeviceRecord, ITrustedDeviceStore } from '../trusted-device-store.js';
import { createTestRuntimeContext } from '../../devices/__tests__/runtime-context-fixture.js';

async function pendingFirstPair(lateCarrierCleanup = false) {
  const runtime = createTestRuntimeContext('/tmp/remote-control-approval-race-test');
  const keyPair = await generateIdentityKeyPair(true);
  const publicKeySpki = await exportPublicKey(keyPair.publicKey);
  const records = new Map<string, ITrustedDeviceRecord>();
  const store: ITrustedDeviceStore = {
    get: (id) => records.get(id),
    list: () => [...records.values()],
    upsert: (record) => {
      records.set(record.deviceId, record);
    },
    revoke: (id) => records.delete(id),
  };
  const answer = deferred<boolean>();
  const cleanup = deferred<void>();
  let approvalSignal: AbortSignal | undefined;
  const approve = vi.fn((_request: ICapabilityApprovalRequest, signal?: AbortSignal) => {
    approvalSignal = signal;
    return answer.promise;
  });
  const approvalFinished = vi.fn();
  const bridge = {
    attach: vi.fn(),
    detach: vi.fn(),
    dispose: vi.fn(),
    onClientMessage: vi.fn(),
    setDriverId: vi.fn(),
  };
  const accepted = vi.fn();
  const rejected = vi.fn();
  const frames: { t?: string }[] = [];
  const waiting: TPairingFrame[] = [];
  let device: ReturnType<typeof startPairingHandshake> | undefined;
  let secret = '';
  const carrier = fakeCarrier((data) => {
      const frame = JSON.parse(data) as { t?: string };
      frames.push(frame);
      if (frame.t === 'pair-nonce' || frame.t === 'pair-confirm') {
        if (device) device.onFrame(frame as TPairingFrame);
        else waiting.push(frame as TPairingFrame);
      }
  });
  const session = createTestInteractiveSession();
  const controller = new RemoteControlController({
    productRuntime: runtime,
    host: { registerInitial: vi.fn(), promoteWinner: vi.fn() },
    readRelayUrl: () => 'ws://fixture-relay',
    readClientUrl: () => 'https://fixture-client/',
    getSession: () => session,
    renderQr: async () => '[FIXTURE QR]',
    trustedDeviceStore: store,
    loadHostIdentity: async () => ({
      keyPair,
      publicKeySpki,
      hostIdentityId: await deriveIdentityId(publicKeySpki),
    }),
    operatorApprover: { approve },
    createResumeBridge: () => bridge as unknown as SessionResumeBridge,
    createSignaling: () => {
      const [host, remote] = createInMemorySignalingPair();
      remote.onSignal((message) => {
        if (message.kind === 'offer') {
          remote.send({ kind: 'answer', data: { sdp: 'a=fingerprint:sha-256 BB:BB' } });
        }
      });
      return host;
    },
    createTransport: (_context, signaling, pairingSecret, hooks, _ice, reconnect) => {
      secret = pairingSecret;
      const transport = new WebRtcTransport({
        cryptoContext: runtime.cryptoContext,
        signaling,
        secret,
        reconnect,
        resumeBridge: bridge as unknown as SessionResumeBridge,
        loadDataChannel: () => carrier.module,
        connectionApproval: {
          approve: async (context: Parameters<typeof hooks.connectionApproval.approve>[0]) => {
            try {
              return await hooks.connectionApproval.approve(context);
            } finally {
              approvalFinished();
            }
          },
        },
        onPaired: (result?: IPairingResult) => {
          accepted();
          hooks.onPaired(result);
        },
        onPairingFailed: () => {
          rejected();
          hooks.onPairingFailed();
        },
      });
      const stop = transport.stop.bind(transport);
      transport.stop = async () => {
        if (lateCarrierCleanup) await cleanup.promise;
        await stop();
      };
      return transport;
    },
  });
  await controller.enable();
  await vi.waitFor(() => expect(carrier.ready()).toBe(true));
  device = startPairingHandshake(runtime.cryptoContext, {
    secret,
    role: 'responder',
    localFingerprint: 'BB:BB',
    remoteFingerprint: 'AA:AA',
    send: (frame) => carrier.receive(JSON.stringify(frame)),
    timeoutMs: 1000,
  });
  for (const frame of waiting.splice(0)) device.onFrame(frame);
  await device.result;
  await vi.waitFor(() => expect(frames.some((f) => f.t === 'enroll-key')).toBe(true));
  const deviceKeys = await generateIdentityKeyPair(false);
  const deviceSpki = await exportPublicKey(deviceKeys.publicKey);
  const deviceId = await deriveIdentityId(deviceSpki);
  carrier.receive(JSON.stringify({ t: 'enroll-key', spki: deviceSpki }));
  await vi.waitFor(() => expect(approve).toHaveBeenCalledOnce());
  expect(approve.mock.calls[0]?.[0].deviceId).toBe(deviceId);
  expect(store.get(deviceId)).toBeUndefined();
  const heldFrame = JSON.stringify({ type: 'get-messages' });
  carrier.receive(heldFrame);
  expect(bridge.attach).not.toHaveBeenCalled();
  return {
    controller,
    store,
    answer,
    cleanup,
    bridge,
    accepted,
    rejected,
    deviceId,
    heldFrame,
    approvalFinished,
    approvalSignal: () => approvalSignal,
  };
}

describe('controller and actual pairing gate approval race', () => {
  it('a healthy explicit approval enrolls the device and forwards its held session frame', async () => {
    const f = await pendingFirstPair();
    try {
      f.answer.resolve(true);
      await vi.waitFor(() => expect(f.accepted).toHaveBeenCalledOnce());
      expect(f.store.get(f.deviceId)).toBeDefined();
      expect(f.bridge.attach).toHaveBeenCalledOnce();
      expect(f.bridge.onClientMessage).toHaveBeenCalledWith(f.heldFrame);
    } finally {
      await f.controller.stop();
    }
  });

  it.each([false, true])(
    'revoking an unenrolled device rejects a late yes (late carrier cleanup: %s)',
    async (late) => {
      const f = await pendingFirstPair(late);
      try {
        expect(f.controller.revokeDevice(f.deviceId)).toBe(false);
        f.answer.resolve(true);
        await vi.waitFor(() => expect(f.approvalFinished).toHaveBeenCalledOnce());
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(f.accepted).not.toHaveBeenCalled();
        expect(f.bridge.attach).not.toHaveBeenCalled();
        expect(f.bridge.onClientMessage).not.toHaveBeenCalled();
        expect(f.store.get(f.deviceId)).toBeUndefined();
        expect(f.controller.getStatus()).toEqual({ state: 'off' });
        if (!late) expect(f.approvalSignal()?.aborted).toBe(true);
        else expect(f.rejected).toHaveBeenCalledOnce();
      } finally {
        f.answer.resolve(false);
        f.cleanup.resolve();
        await f.controller.stop();
      }
    },
  );
});

/** Drive the installed transport's native boundary while exercising its real pairing gate. */
function fakeCarrier(send: (data: string) => void) {
  let inbound: ((message: string) => void) | undefined;
  let onDescription: ((sdp: string, type: string) => void) | undefined;
  let onState: ((state: string) => void) | undefined;
  const PeerConnection = function () {
    return {
      close: () => {},
      setLocalDescription: (type: string) => queueMicrotask(() => onDescription?.('a=fingerprint:sha-256 AA:AA', type)),
      setRemoteDescription: () => onState?.('connected'),
      remoteFingerprint: () => ({ value: 'BB:BB', algorithm: 'sha-256' }),
      addRemoteCandidate: () => {},
      onStateChange: (callback: (state: string) => void) => { onState = callback; },
      onLocalDescription: (callback: (sdp: string, type: string) => void) => { onDescription = callback; },
      onLocalCandidate: () => {},
      onDataChannel: () => {},
      createDataChannel: () => ({
        close: () => {}, sendMessage: (data: string) => { send(data); return true; },
        isOpen: () => true, bufferedAmount: () => 0, onOpen: () => {}, onClosed: () => {}, onError: () => {},
        onMessage: (callback: (message: string) => void) => { inbound = callback; },
      }),
    };
  } as unknown as IDataChannelModule['PeerConnection'];
  return {
    module: { PeerConnection },
    ready: () => inbound !== undefined,
    receive: (message: string) => {
      if (!inbound) throw new Error('The data channel is not ready.');
      inbound(message);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
