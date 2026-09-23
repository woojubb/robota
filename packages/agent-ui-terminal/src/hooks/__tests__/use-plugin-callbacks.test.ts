import { describe, expect, it, vi } from 'vitest';

import { resolvePluginCallbacks } from '../usePluginCallbacks.js';

import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';

describe('resolvePluginCallbacks', () => {
  it('preserves the host-provided plugin capability', () => {
    const adapter = { listInstalled: vi.fn() } as unknown as ICommandPluginAdapter;
    expect(resolvePluginCallbacks(adapter)).toBe(adapter);
  });

  it('rejects explicitly when the host has no plugin capability', async () => {
    await expect(resolvePluginCallbacks().listInstalled()).rejects.toThrow(
      'Plugin management is unavailable in this host.',
    );
  });
});
