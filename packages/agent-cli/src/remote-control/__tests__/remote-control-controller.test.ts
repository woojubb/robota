import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { parsePairingUrl } from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it, vi } from 'vitest';

import { RemoteControlController } from '../remote-control-controller.js';
import { createTestRuntimeContext } from '../../devices/__tests__/runtime-context-fixture.js';

import type { IRemoteControlControllerDeps } from '../remote-control-controller.js';
import type { IConnectionApproval, ISignalingClient } from '@robota-sdk/agent-transport-webrtc';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { IProtocolSession } from '@robota-sdk/agent-transport';
import type { IOperatorApprover } from '@robota-sdk/agent-interface-session-mobility';
import type { IHostIdentity } from '../host-identity.js';
import type { ITrustedDeviceStore } from '../trusted-device-store.js';

/**
 * REMOTE-008 Step 4 — the composition-root remote-control controller. Driven with injected construction
 * seams (no real relay / WebRTC / QR), so the enable/stop/status + fail-closed logic is unit-tested.
 */

/** The client base URL `makeDeps` injects; the pairing link must be on exactly this origin. */
const CLIENT_ORIGIN = 'https://remote.example';

/**
 * The pairing link the controller emitted: `renderPairingMessage` puts it on the message's last line.
 *
 * SEC-004 shape-match (the `js/regex/missing-regexp-anchor` family, unflagged here): the assertions
 * used to be `expect(msg).toMatch(/https:\/\/remote\.example\//)` — an unanchored substring probe over
 * the whole message, which a link like `https://phish.test/?next=https://remote.example/` satisfies
 * just as well as the real one. Extracting the link and parsing it makes the check exact: the origin
 * is compared, not merely found somewhere in the prose.
 */
function pairingLinkOf(message: string): URL {
  const lastLine = message.split('\n').at(-1) ?? '';
  return new URL(lastLine);
}

function makeDeps(over: Partial<IRemoteControlControllerDeps> = {}): {
  deps: IRemoteControlControllerDeps;
  registered: IConfigurableTransport<IProtocolSession>[];
  transport: {
    attach: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  signaling: { close: ReturnType<typeof vi.fn> };
  hooks: { onPaired?: () => void; onPairingFailed?: () => void };
  captured: { ice?: { iceServers?: unknown; forceTurn?: boolean } };
} {
  const registered: IConfigurableTransport<IProtocolSession>[] = [];
  const host = {
    registerInitial: (peer: IConfigurableTransport<IProtocolSession>) => {
      registered.push(peer);
    },
    promoteWinner: vi.fn(),
  };
  const transport = {
    name: 'webrtc',
    lifecycle: { kind: 'service' as const },
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
  // Capture the ICE config the controller passes into the transport (REMOTE-010).
  const captured: { ice?: { iceServers?: unknown; forceTurn?: boolean } } = {};
  const deps: IRemoteControlControllerDeps = {
    productRuntime: createTestRuntimeContext('/tmp/remote-control-controller-test'),
    host,
    readRelayUrl: () => 'ws://127.0.0.1:9999',
    readClientUrl: () => 'https://remote.example/',
    getSession: () => Object.assign(createTestInteractiveSession(), {}),
    renderQr: () => Promise.resolve('[QR]'),
    createSignaling: () => signaling as unknown as ISignalingClient,
    createTransport: (_context, _s, _secret, h, ice) => {
      hooks.onPaired = h.onPaired;
      hooks.onPairingFailed = h.onPairingFailed;
      captured.ice = ice;
      return transport as unknown as IConfigurableTransport<IProtocolSession>;
    },
    ...over,
  };
  return { deps, registered, transport, signaling, hooks, captured };
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
    const link = pairingLinkOf(msg);
    expect(link.origin).toBe(CLIENT_ORIGIN);
    expect(link.pathname).toBe('/');
    expect(link.search).toBe(''); // the secret must never reach the server as a query param
    const pairing = parsePairingUrl(link.toString());
    expect(pairing.rendezvous).not.toBe('');
    expect(pairing.secret).not.toBe('');
    const status = controller.getStatus();
    expect(status.state).toBe('awaiting-pairing');
  });

  it('D5: unset clientUrl fails closed — reports, constructs/starts nothing, status untouched (no dead link)', async () => {
    const createTransport = vi.fn();
    const { deps, registered } = makeDeps({ readClientUrl: () => undefined, createTransport });
    const controller = new RemoteControlController(deps);
    const msg = await controller.enable();
    expect(msg).toMatch(/clientUrl/);
    expect(createTransport).not.toHaveBeenCalled();
    expect(registered).toHaveLength(0);
    expect(controller.getStatus()).toEqual({ state: 'off' }); // untouched (no new enum variant)
  });

  it('REMOTE-010: passes configured iceServers + forceTurn into the transport', async () => {
    const iceServers = [{ urls: 'turn:turn.example:3478', username: 'u', credential: 'p' }];
    const { deps, captured } = makeDeps({
      readIceServers: () => iceServers,
      readForceTurn: () => true,
    });
    await new RemoteControlController(deps).enable();
    expect(captured.ice).toEqual({ iceServers, forceTurn: true });
  });

  it('REMOTE-010: forceTurn without a TURN server fails closed — constructs nothing', async () => {
    const createTransport = vi.fn();
    const { deps } = makeDeps({
      readIceServers: () => [{ urls: 'stun:stun.example:19302' }], // STUN only, no TURN
      readForceTurn: () => true,
      createTransport,
    });
    const msg = await new RemoteControlController(deps).enable();
    expect(msg).toMatch(/forceTurn.*requires.*TURN/i);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('REMOTE-010: a malformed iceServers config fails closed (throwing reader surfaced, nothing constructed)', async () => {
    const createTransport = vi.fn();
    const { deps } = makeDeps({
      readIceServers: () => {
        throw new Error(
          'Invalid ICE config: iceServers[0].urls "http://x" must use a stun:/turn: scheme.',
        );
      },
      createTransport,
    });
    const msg = await new RemoteControlController(deps).enable();
    expect(msg).toMatch(/Invalid ICE config/);
    expect(createTransport).not.toHaveBeenCalled();
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

  it('stop cancels identity loading before any transport can be registered', async () => {
    const identity = deferred<IHostIdentity>();
    const { deps, registered, transport } = makeDeps({
      trustedDeviceStore: emptyStore(),
      loadHostIdentity: () => identity.promise,
    });
    const controller = new RemoteControlController(deps);
    const enabling = controller.enable();
    await controller.stop();
    identity.resolve(syntheticIdentity());
    expect(await enabling).toMatch(/cancelled/i);
    expect(registered).toHaveLength(0);
    expect(transport.start).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ state: 'off' });
  });

  it('concurrent enables share one identity load and one owned transport', async () => {
    const identity = deferred<IHostIdentity>();
    const loadHostIdentity = vi.fn(() => identity.promise);
    const { deps, registered, transport } = makeDeps({
      trustedDeviceStore: emptyStore(),
      loadHostIdentity,
    });
    const controller = new RemoteControlController(deps);
    const first = controller.enable();
    const second = controller.enable();
    identity.resolve(syntheticIdentity());
    expect(await first).toBe(await second);
    expect(loadHostIdentity).toHaveBeenCalledOnce();
    expect(registered).toHaveLength(1);
    expect(transport.start).toHaveBeenCalledOnce();
    await controller.stop();
  });

  it('stop withdraws enable without waiting for an unresponsive identity reader', async () => {
    const identity = deferred<IHostIdentity>();
    const settled = vi.fn();
    const { deps, registered } = makeDeps({
      trustedDeviceStore: emptyStore(),
      loadHostIdentity: () => identity.promise,
    });
    const controller = new RemoteControlController(deps);
    const enabling = controller.enable().then(settled);
    try {
      await controller.stop();
      await vi.waitFor(
        () => expect(settled).toHaveBeenCalledWith(expect.stringMatching(/cancelled/i)),
        { timeout: 100 },
      );
      expect(registered).toHaveLength(0);
    } finally {
      identity.resolve(syntheticIdentity());
      await enabling;
      await controller.stop();
    }
  });

  it('a transport construction failure releases its already allocated signaling', async () => {
    const { deps, signaling } = makeDeps({
      createTransport: () => {
        throw new Error('fixture construction failed');
      },
    });
    const controller = new RemoteControlController(deps);
    await expect(controller.enable()).rejects.toThrow('fixture construction failed');
    await controller.stop();
    expect(signaling.close).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toEqual({ state: 'off' });
  });

  it('enable on a paired connection preserves the owned transport', async () => {
    const { deps, registered, hooks, transport } = makeDeps();
    const controller = new RemoteControlController(deps);
    await controller.enable();
    hooks.onPaired?.();
    expect(await controller.enable()).toMatch(/already connected/i);
    expect(registered).toHaveLength(1);
    expect(transport.start).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toEqual({ state: 'paired' });
    await controller.stop();
  });

  it('stop withdraws a pairing link whose QR render is still pending', async () => {
    const qr = deferred<string>();
    const { deps } = makeDeps({ renderQr: () => qr.promise });
    const controller = new RemoteControlController(deps);
    const enabling = controller.enable();
    await controller.stop();
    qr.resolve('[STALE QR]');
    const message = await enabling;
    expect(message).toMatch(/cancelled/i);
    expect(message).not.toContain('[STALE QR]');
    expect(message).not.toContain('https://remote.example');
    expect(controller.getStatus()).toEqual({ state: 'off' });
  });

  it('a fresh enable waits for the old transport cleanup', async () => {
    const closing = deferred<void>();
    const { deps, registered, transport } = makeDeps();
    transport.stop.mockReturnValueOnce(closing.promise);
    const controller = new RemoteControlController(deps);
    await controller.enable();
    const stopping = controller.stop();
    const enabling = controller.enable();
    try {
      await Promise.resolve();
      expect(registered).toHaveLength(1);
      expect(transport.start).toHaveBeenCalledOnce();
    } finally {
      closing.resolve();
      await stopping;
      await enabling;
      await controller.stop();
    }
    expect(registered).toHaveLength(2);
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
    expect(pairingLinkOf(msg).origin).toBe(CLIENT_ORIGIN);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function emptyStore(): ITrustedDeviceStore {
  return { get: () => undefined, list: () => [], upsert: () => undefined, revoke: () => false };
}

function syntheticIdentity(): IHostIdentity {
  return {
    keyPair: {} as CryptoKeyPair,
    publicKeySpki: 'fixture-spki',
    hostIdentityId: 'fixture-id',
  };
}

describe('RemoteControlController — a paired device drives only with the operator’s approval', () => {
  function capturing(over: Partial<IRemoteControlControllerDeps> = {}) {
    let approval: IConnectionApproval | undefined;
    const base = makeDeps();
    const deps: IRemoteControlControllerDeps = {
      ...base.deps,
      createTransport: (_context, signaling, secret, hooks, ice, ...rest) => {
        approval = hooks.connectionApproval;
        return base.deps.createTransport!(_context, signaling, secret, hooks, ice, ...rest);
      },
      ...over,
    };
    return { deps, approval: () => approval };
  }

  const live = (): AbortSignal => new AbortController().signal;

  it('refuses every connection when no operator can be asked', async () => {
    const { deps, approval } = capturing();
    await new RemoteControlController(deps).enable();
    expect(approval()).toBeDefined();
    await expect(
      approval()!.approve({ deviceId: 'dev-1', viaReconnect: false, signal: live() }),
    ).resolves.toBe(false);
  });

  it('asks the operator whether this device may drive, for each connection', async () => {
    const operatorApprover = { approve: vi.fn<IOperatorApprover['approve']>(async () => true) };
    const { deps, approval } = capturing({ operatorApprover });
    await new RemoteControlController(deps).enable();

    const connection = new AbortController();
    const signal = connection.signal;
    await expect(
      approval()!.approve({ deviceId: 'dev-1', viaReconnect: false, signal }),
    ).resolves.toBe(true);
    await expect(
      approval()!.approve({ deviceId: 'dev-1', viaReconnect: true, signal: live() }),
    ).resolves.toBe(true);
    expect(operatorApprover.approve).toHaveBeenCalledTimes(2);
    expect(operatorApprover.approve).toHaveBeenCalledWith(
      { capability: 'drive', scope: 'connection', deviceId: 'dev-1', locality: 'another-host' },
      expect.any(AbortSignal),
    );
    const operatorSignal = operatorApprover.approve.mock.calls[0]?.[1];
    expect(operatorSignal?.aborted).toBe(false);
    connection.abort();
    expect(operatorSignal?.aborted).toBe(true);
  });

  it('refuses the connection the operator declines', async () => {
    const { deps, approval } = capturing({ operatorApprover: { approve: async () => false } });
    await new RemoteControlController(deps).enable();
    await expect(approval()!.approve({ viaReconnect: false, signal: live() })).resolves.toBe(false);
  });

  it('refuses a connection that went away, even if the operator then says yes', async () => {
    const gone = new AbortController();
    const operatorApprover = {
      approve: vi.fn(async () => {
        gone.abort();
        return true;
      }),
    };
    const { deps, approval } = capturing({ operatorApprover });
    await new RemoteControlController(deps).enable();
    await expect(
      approval()!.approve({ deviceId: 'dev-1', viaReconnect: false, signal: gone.signal }),
    ).resolves.toBe(false);
  });
});
