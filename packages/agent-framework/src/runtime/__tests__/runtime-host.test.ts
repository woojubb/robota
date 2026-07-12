/**
 * RUNTIME-001 TC-01 — the shared runtime host builds the session, owns the transport lifecycle
 * (startAll on start, stopAll on shutdown), and shuts down idempotently. Presentation-free: this test
 * imports no `agent-transport-tui`/ink.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InteractiveSession } from '../../interactive/interactive-session.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startRuntimeHost } from '../runtime-host.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type {
  IInteractiveSession,
  ITransportRegistryView,
} from '@robota-sdk/agent-interface-transport';

function stubProvider(): IAIProvider {
  return {
    name: 'runtime-host-test-provider',
    version: '1.0.0',
    async chat() {
      return {
        id: 'a1',
        role: 'assistant',
        content: 'ok',
        state: 'complete',
        timestamp: new Date(),
      };
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools() {
      return true;
    },
    validateConfig() {
      return true;
    },
  } as unknown as IAIProvider;
}

function stubRegistry(): ITransportRegistryView<IInteractiveSession> & {
  startAll: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
} {
  return {
    startAll: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined),
  } as unknown as ITransportRegistryView<IInteractiveSession> & {
    startAll: ReturnType<typeof vi.fn>;
    stopAll: ReturnType<typeof vi.fn>;
  };
}

describe('startRuntimeHost (RUNTIME-001 TC-01)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'runtime-host-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('builds the InteractiveSession and calls transportRegistry.startAll with it', async () => {
    const registry = stubRegistry();
    const host = await startRuntimeHost({
      session: { cwd, provider: stubProvider() },
      transportRegistry: registry,
    });

    expect(host.session).toBeInstanceOf(InteractiveSession);
    expect(registry.startAll).toHaveBeenCalledTimes(1);
    expect(registry.startAll).toHaveBeenCalledWith(host.session);

    await host.shutdown();
  });

  it('shutdown() stops the transports and is idempotent', async () => {
    const registry = stubRegistry();
    const host = await startRuntimeHost({
      session: { cwd, provider: stubProvider() },
      transportRegistry: registry,
    });

    const shutdownSpy = vi.spyOn(host.session, 'shutdown');
    await host.shutdown('first');
    await host.shutdown('second'); // idempotent — no second teardown

    expect(registry.stopAll).toHaveBeenCalledTimes(1);
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it('runs without a transport registry (no-op lifecycle)', async () => {
    const host = await startRuntimeHost({ session: { cwd, provider: stubProvider() } });
    expect(host.session).toBeInstanceOf(InteractiveSession);
    await expect(host.shutdown()).resolves.toBeUndefined();
  });
});
