import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { TransportRegistry } from '../transport-registry';
import { bindTransportAdapter } from '../bind-transport-adapter.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';

function makeTransport(
  name: string,
  stop: () => Promise<void>,
): IConfigurableTransport<IInteractiveSession> {
  return {
    name,
    lifecycle: Object.freeze({ kind: 'service' }),
    defaultEnabled: true,
    attach: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop,
  } as unknown as IConfigurableTransport<IInteractiveSession>;
}

function register(
  registry: TransportRegistry,
  transport: IConfigurableTransport<IInteractiveSession>,
): void {
  registry.register(bindTransportAdapter(transport, createTestInteractiveSession()));
}

describe('TransportRegistry.stopAll (best-effort, CORE-013)', () => {
  it('stops every transport even when one stop fails, and collects the error', async () => {
    const registry = new TransportRegistry(
      path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'registry-'))), 'settings.json'),
    );
    const stoppedSecond = vi.fn().mockResolvedValue(undefined);
    register(
      registry,
      makeTransport('failing', async () => {
        throw new Error('stop boom');
      }),
    );
    register(registry, makeTransport('healthy', stoppedSecond));

    const result = await registry.stopAll();

    expect(stoppedSecond).toHaveBeenCalledTimes(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('stop boom');
  });

  it('returns an empty error list when all stops succeed', async () => {
    const registry = new TransportRegistry(
      path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'registry-'))), 'settings.json'),
    );
    register(registry, makeTransport('a', vi.fn().mockResolvedValue(undefined)));

    await expect(registry.stopAll()).resolves.toEqual({ errors: [] });
  });
});
