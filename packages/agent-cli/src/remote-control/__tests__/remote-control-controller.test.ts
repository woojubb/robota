import { describe, expect, it, vi } from 'vitest';

import { RemoteControlController } from '../remote-control-controller.js';

import type { IRemoteControlControllerDeps } from '../remote-control-controller.js';
import type { ISignalingClient } from '@robota-sdk/agent-transport-webrtc';
import type { TransportRegistry } from '@robota-sdk/agent-transport';
import type {
  IConfigurableTransport,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';

/**
 * REMOTE-008 Step 4 — the composition-root remote-control controller. Driven with injected construction
 * seams (no real relay / werift / QR), so the enable/stop/status + fail-closed logic is unit-tested.
 */

function makeDeps(over: Partial<IRemoteControlControllerDeps> = {}): {
  deps: IRemoteControlControllerDeps;
  registered: IConfigurableTransport<IInteractiveSession>[];
  transport: {
    attach: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  signaling: { close: ReturnType<typeof vi.fn> };
  hooks: { onPaired?: () => void; onPairingFailed?: () => void };
} {
  const registered: IConfigurableTransport<IInteractiveSession>[] = [];
  const registry = {
    register: (t: IConfigurableTransport<IInteractiveSession>) => registered.push(t),
  } as unknown as TransportRegistry;
  const transport = {
    name: 'webrtc',
    defaultEnabled: false,
    attach: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    validateOptions: () => true,
  };
  const signaling = { send: vi.fn(), onSignal: vi.fn(() => () => {}), close: vi.fn() };
  // Capture the pairing lifecycle hooks the controller passes into the transport, so a test can simulate
  // the gate accepting / rejecting.
  const hooks: { onPaired?: () => void; onPairingFailed?: () => void } = {};
  const deps: IRemoteControlControllerDeps = {
    registry,
    readRelayUrl: () => 'ws://127.0.0.1:9999',
    readClientUrl: () => 'https://remote.example/',
    getSession: () => ({}) as IInteractiveSession,
    renderQr: () => Promise.resolve('[QR]'),
    createSignaling: () => signaling as unknown as ISignalingClient,
    createTransport: (_s, _secret, h) => {
      hooks.onPaired = h.onPaired;
      hooks.onPairingFailed = h.onPairingFailed;
      return transport as unknown as IConfigurableTransport<IInteractiveSession>;
    },
    ...over,
  };
  return { deps, registered, transport, signaling, hooks };
}

describe('RemoteControlController (REMOTE-008)', () => {
  it('starts off', () => {
    const { deps } = makeDeps();
    expect(new RemoteControlController(deps).getStatus()).toEqual({ state: 'off' });
  });

  it('fail-closed: no relay configured → does nothing, status no-relay, no transport constructed', async () => {
    const createTransport = vi.fn();
    const { deps, registered } = makeDeps({ readRelayUrl: () => undefined, createTransport });
    const controller = new RemoteControlController(deps);
    const msg = await controller.enable();
    expect(msg).toMatch(/relayUrl/);
    expect(controller.getStatus()).toEqual({ state: 'no-relay' });
    expect(createTransport).not.toHaveBeenCalled();
    expect(registered).toHaveLength(0);
  });

  it('enable: constructs + registers + attaches + starts the transport and returns a QR + link', async () => {
    const { deps, registered, transport } = makeDeps();
    const controller = new RemoteControlController(deps);
    const msg = await controller.enable();

    expect(registered).toHaveLength(1);
    expect(transport.attach).toHaveBeenCalledTimes(1);
    expect(transport.start).toHaveBeenCalledTimes(1);
    // The pairing link is a real URL with the secret + rendezvous in the FRAGMENT (never on the server).
    expect(msg).toContain('[QR]');
    expect(msg).toMatch(/https:\/\/remote\.example\/#.*r=.*s=/);
    const status = controller.getStatus();
    expect(status.state).toBe('awaiting-pairing');
  });

  it('enable with no session yet → reports and constructs nothing', async () => {
    const createTransport = vi.fn();
    const { deps } = makeDeps({ getSession: () => undefined, createTransport });
    const msg = await new RemoteControlController(deps).enable();
    expect(msg).toMatch(/no active session/i);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('a second enable while awaiting pairing re-reports the same link (no second transport)', async () => {
    const { deps, registered } = makeDeps();
    const controller = new RemoteControlController(deps);
    const first = await controller.enable();
    const second = await controller.enable();
    expect(registered).toHaveLength(1); // not re-constructed
    expect(second).toBe(first);
  });

  it('stop: tears down transport + signaling and returns to off', async () => {
    const { deps, transport, signaling } = makeDeps();
    const controller = new RemoteControlController(deps);
    await controller.enable();
    const msg = await controller.stop();
    expect(transport.stop).toHaveBeenCalledTimes(1);
    expect(signaling.close).toHaveBeenCalledTimes(1);
    expect(msg).toMatch(/stopped/i);
    expect(controller.getStatus()).toEqual({ state: 'off' });
  });

  it('stop when not running is a safe no-op message', async () => {
    const { deps } = makeDeps();
    const msg = await new RemoteControlController(deps).stop();
    expect(msg).toMatch(/not running/i);
  });

  it('onPaired hook flips status to paired', async () => {
    const { deps, hooks } = makeDeps();
    const controller = new RemoteControlController(deps);
    await controller.enable();
    expect(controller.getStatus().state).toBe('awaiting-pairing');
    hooks.onPaired?.();
    expect(controller.getStatus()).toEqual({ state: 'paired' });
  });

  it('onPairingFailed hook tears down (no leak) and returns to off', async () => {
    const { deps, hooks, transport, signaling } = makeDeps();
    const controller = new RemoteControlController(deps);
    await controller.enable();
    hooks.onPairingFailed?.();
    await new Promise((r) => setTimeout(r, 0)); // let the detached async teardown run to completion
    expect(transport.stop).toHaveBeenCalledTimes(1);
    expect(signaling.close).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual({ state: 'off' });
  });

  it('a start() failure resets to off and reports to the operator (not swallowed)', async () => {
    const reportError = vi.fn();
    const { deps, transport } = makeDeps({ reportError });
    transport.start.mockRejectedValue(new Error('WebRTC unavailable'));
    const controller = new RemoteControlController(deps);
    await controller.enable();
    await Promise.resolve(); // let the detached start().catch run
    await Promise.resolve();
    expect(reportError).toHaveBeenCalledWith(
      expect.stringMatching(/failed to start.*WebRTC unavailable/i),
    );
    expect(controller.getStatus()).toEqual({ state: 'off' });
  });

  it('falls back to the link alone when QR rendering fails', async () => {
    const { deps } = makeDeps({ renderQr: () => Promise.reject(new Error('no qr')) });
    const msg = await new RemoteControlController(deps).enable();
    expect(msg).not.toContain('[QR]');
    expect(msg).toMatch(/https:\/\/remote\.example\//);
  });
});
