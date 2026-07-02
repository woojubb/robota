import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { TransportRegistry } from '../transport-registry';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';

function makeTransport(
  name: string,
  stop: () => Promise<void>,
): IConfigurableTransport<IInteractiveSession> {
  return {
    name,
    defaultEnabled: true,
    attach: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop,
  } as unknown as IConfigurableTransport<IInteractiveSession>;
}

describe('TransportRegistry.stopAll (best-effort, CORE-013)', () => {
  it('stops every transport even when one stop fails, and collects the error', async () => {
    const registry = new TransportRegistry(
      path.join(mkdtempSync(path.join(tmpdir(), 'registry-')), 'settings.json'),
    );
    const stoppedSecond = vi.fn().mockResolvedValue(undefined);
    registry.register(
      makeTransport('failing', async () => {
        throw new Error('stop boom');
      }),
    );
    registry.register(makeTransport('healthy', stoppedSecond));

    const result = await registry.stopAll();

    expect(stoppedSecond).toHaveBeenCalledTimes(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('stop boom');
  });

  it('returns an empty error list when all stops succeed', async () => {
    const registry = new TransportRegistry(
      path.join(mkdtempSync(path.join(tmpdir(), 'registry-')), 'settings.json'),
    );
    registry.register(makeTransport('a', vi.fn().mockResolvedValue(undefined)));

    await expect(registry.stopAll()).resolves.toEqual({ errors: [] });
  });
});
