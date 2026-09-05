import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { TransportRegistry } from '../transport-registry.js';
import { createMemoryTransportSettingsRepository } from '../transport-settings-repository.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';

/**
 * Issue #2480 — TRANS-002 (persisted options reach a transport, or startup says why they cannot) and
 * TRANS-010 (the registry reads/writes settings through an injected repository, so no test here
 * touches a filesystem).
 */
function configurableTransport(
  name: string,
  over: Partial<Omit<IConfigurableTransport<IInteractiveSession>, 'configure'>> & {
    configure?: ReturnType<typeof vi.fn>;
  } = {},
): IConfigurableTransport<IInteractiveSession> & { configure: ReturnType<typeof vi.fn> } {
  return {
    name,
    lifecycle: Object.freeze({ kind: 'service' as const }),
    defaultEnabled: true,
    optionsSchema: { port: { type: 'number', description: 'port' } },
    validateOptions: (options) => typeof options['port'] !== 'string',
    configure: vi.fn(),
    attach: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    ...over,
  };
}

// The published conformant double, not a bare cast: the registry only hands the session through to
// `attach`, but a cast is what the contract-cast ratchet exists to refuse.
const session = createTestInteractiveSession();

describe('TransportRegistry option delivery (TRANS-002) over an injected repository (TRANS-010)', () => {
  it('delivers persisted options through configure() before attach/start', async () => {
    const repository = createMemoryTransportSettingsRepository({ ws: { options: { port: 4321 } } });
    const registry = new TransportRegistry(repository);
    const transport = configurableTransport('ws');
    registry.register(transport);

    await registry.startAll(session);

    expect(transport.configure).toHaveBeenCalledWith({ port: 4321 });
    expect(transport.configure.mock.invocationCallOrder[0]).toBeLessThan(
      (transport.attach as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  it('does not call configure() when nothing was saved', async () => {
    const registry = new TransportRegistry(createMemoryTransportSettingsRepository());
    const transport = configurableTransport('ws');
    registry.register(transport);
    await registry.startAll(session);
    expect(transport.configure).not.toHaveBeenCalled();
  });

  it('refuses to start with persisted options the transport rejects, naming the code', async () => {
    const repository = createMemoryTransportSettingsRepository({ ws: { options: { port: 'x' } } });
    const registry = new TransportRegistry(repository);
    registry.register(configurableTransport('ws'));
    await expect(registry.startAll(session)).rejects.toMatchObject({
      name: 'TransportStartupError',
      transportName: 'ws',
      cause: { name: 'TransportConfigurationError', code: 'invalid-options' },
    });
  });

  it('refuses to start when options are saved for a transport that cannot receive them (no silent ignore)', async () => {
    const repository = createMemoryTransportSettingsRepository({ ws: { options: { port: 1 } } });
    const registry = new TransportRegistry(repository);
    const transport = configurableTransport('ws');
    delete (transport as { configure?: unknown }).configure;
    registry.register(transport);
    await expect(registry.startAll(session)).rejects.toMatchObject({
      cause: { name: 'TransportConfigurationError', code: 'options-not-applicable' },
    });
  });

  it('setOptions validates before persisting and persists through the repository', async () => {
    const repository = createMemoryTransportSettingsRepository();
    const registry = new TransportRegistry(repository);
    registry.register(configurableTransport('ws'));
    await expect(registry.setOptions('ws', { port: 'nope' })).rejects.toMatchObject({
      name: 'TransportConfigurationError',
      code: 'invalid-options',
    });
    await registry.setOptions('ws', { port: 9000 });
    await registry.setEnabled('ws', false);
    expect(repository.readAll()).toEqual({ ws: { options: { port: 9000 }, enabled: false } });
    expect(registry.getAll()[0]?.config).toEqual({ enabled: false, options: { port: 9000 } });
  });
});
