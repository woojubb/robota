// packages/agent-cli/src/ui/__tests__/PluginTUI.test.tsx
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import PluginTUI from '../PluginTUI.js';
import type { IPluginCallbacks } from '../../commands/slash-executor.js';

function mockCallbacks(): IPluginCallbacks {
  return {
    listInstalled: vi.fn().mockResolvedValue([]),
    listAvailablePlugins: vi.fn().mockResolvedValue([]),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    enable: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn().mockResolvedValue(undefined),
    marketplaceAdd: vi.fn().mockResolvedValue('test-marketplace'),
    marketplaceRemove: vi.fn().mockResolvedValue(undefined),
    marketplaceUpdate: vi.fn().mockResolvedValue(undefined),
    marketplaceList: vi.fn().mockResolvedValue([]),
    reloadPlugins: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PluginTUI', () => {
  it('renders main menu with Marketplace and Installed Plugins', () => {
    const { lastFrame } = render(<PluginTUI callbacks={mockCallbacks()} onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Marketplace');
    expect(frame).toContain('Installed Plugins');
  });

  it('calls onClose when Escape on main menu', async () => {
    let closed = false;
    const { stdin } = render(
      <PluginTUI
        callbacks={mockCallbacks()}
        onClose={() => {
          closed = true;
        }}
      />,
    );
    stdin.write('\x1B');
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(true);
  });

  it('navigates to installed plugins and shows actions', async () => {
    const cbs = mockCallbacks();
    cbs.listInstalled = vi
      .fn()
      .mockResolvedValue([{ name: 'my-plugin', description: 'A plugin', enabled: true }]);
    const { stdin, lastFrame } = render(<PluginTUI callbacks={cbs} onClose={() => {}} />);
    stdin.write('\x1B[B'); // Down to "Installed Plugins"
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 100));
    expect(lastFrame()!).toContain('my-plugin');
  });

  it('navigates to marketplace list on Enter', async () => {
    const cbs = mockCallbacks();
    cbs.marketplaceList = vi.fn().mockResolvedValue([{ name: 'test-mp', type: 'github' }]);
    const { stdin, lastFrame } = render(<PluginTUI callbacks={cbs} onClose={() => {}} />);
    stdin.write('\r'); // Enter on "Marketplace"
    await new Promise((r) => setTimeout(r, 100));
    const frame = lastFrame()!;
    expect(frame).toContain('Add Marketplace');
  });
});
