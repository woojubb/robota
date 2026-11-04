import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransportRegistry } from '@robota-sdk/agent-framework';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { IProtocolSession } from '@robota-sdk/agent-transport';
import { RemoteControlController } from '../remote-control-controller.js';
import { createRemoteControlTransportHost } from '../transport-host-adapter.js';
import { createTestRuntimeContext } from '../../devices/__tests__/runtime-context-fixture.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { SecureSurfaceRefusedError } from '../../secure/secure-surfaces.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function registry(): TransportRegistry {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'remote-host-port-')));
  directories.push(directory);
  return new TransportRegistry(join(directory, 'settings.json'));
}

function peer(): IConfigurableTransport<IProtocolSession> {
  return {
    name: 'webrtc',
    lifecycle: { kind: 'service' },
    defaultEnabled: false,
    attach: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    validateOptions: () => true,
  };
}

describe('remote control host boundary', () => {
  it('accepts the protocol session and a two-operation host without the full session or registry', () => {
    const session = {} as IProtocolSession;
    const host = { registerInitial: vi.fn(), promoteWinner: vi.fn() };
    const controller = new RemoteControlController({
      productRuntime: createTestRuntimeContext('/tmp/remote-host-port-test'),
      host,
      readRelayUrl: () => undefined,
      readClientUrl: () => undefined,
      getSession: () => session,
      renderQr: async () => '',
    });
    expect(controller.getStatus()).toEqual({ state: 'off' });
  });

  it('binds the exact promoted peer so registry shutdown reaches the winner', async () => {
    const transportRegistry = registry();
    const host = createRemoteControlTransportHost(
      transportRegistry,
      createTestRuntimeContext('/tmp/remote-host-port-test'),
    );
    const session = {} as IProtocolSession;
    const first = peer();
    const winner = peer();

    host.registerInitial(first, session);
    expect(transportRegistry.getAll().map(({ transport }) => transport.name)).toEqual(['webrtc']);
    host.promoteWinner(winner, session);
    const entries = transportRegistry.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.transport.binding).toBe('bound');
    await entries[0]?.transport.start();
    expect(winner.attach).toHaveBeenCalledExactlyOnceWith(session);
    expect(first.attach).not.toHaveBeenCalled();
    await transportRegistry.stopAll();
    expect(winner.stop).toHaveBeenCalledOnce();
    expect(first.stop).not.toHaveBeenCalled();
  });

  it('in secure mode never starts the registered peer, even when the settings enable it', async () => {
    const transportRegistry = registry();
    const productRuntime = createTestRuntimeContext('/tmp/remote-host-port-secure-test');
    const host = createRemoteControlTransportHost(transportRegistry, productRuntime);
    const registered = peer();
    host.registerInitial(registered, {} as IProtocolSession);
    // A session switch restarts every enabled transport through the registry, not the controller.
    await transportRegistry.setEnabled('webrtc', true);
    overrideProductSecureMode(productRuntime, true);

    const failure: unknown = await transportRegistry.startAll().then(
      () => transportRegistry.stopAll().then(() => undefined),
      (error: unknown) => error,
    );

    expect((failure as { cause?: unknown } | undefined)?.cause).toBeInstanceOf(
      SecureSurfaceRefusedError,
    );
    expect(registered.start).not.toHaveBeenCalled();
  });
});
