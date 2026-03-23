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

  // Regression: arrow keys must work after navigating to a sub-screen (resolvedRef reset via key)
  it('arrow keys work in marketplace list after navigating from main', async () => {
    const cbs = mockCallbacks();
    cbs.marketplaceList = vi.fn().mockResolvedValue([
      { name: 'mp-a', type: 'github' },
      { name: 'mp-b', type: 'git' },
    ]);
    const { stdin, lastFrame } = render(<PluginTUI callbacks={cbs} onClose={() => {}} />);
    stdin.write('\r'); // Enter on "Marketplace"
    await new Promise((r) => setTimeout(r, 100));
    // Should be on marketplace-list with arrow keys working
    stdin.write('\x1B[B'); // Down from "Add Marketplace" to "mp-a"
    stdin.write('\x1B[B'); // Down to "mp-b"
    await new Promise((r) => setTimeout(r, 50));
    const frame = lastFrame()!;
    // "mp-b" should be highlighted (has > prefix)
    expect(frame).toContain('mp-b');
    // Select mp-b → should navigate to marketplace-action
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()!).toContain('Browse plugins');
  });

  // Regression: installed plugin browse shows uninstall for already-installed plugins
  it('selecting installed plugin in browse shows uninstall action', async () => {
    const cbs = mockCallbacks();
    cbs.marketplaceList = vi.fn().mockResolvedValue([{ name: 'test-mp', type: 'github' }]);
    cbs.listAvailablePlugins = vi.fn().mockResolvedValue([
      { name: 'my-plugin', description: 'A plugin', installed: true },
      { name: 'new-plugin', description: 'Not installed', installed: false },
    ]);
    const { stdin, lastFrame } = render(<PluginTUI callbacks={cbs} onClose={() => {}} />);
    // Main → Marketplace
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 100));
    // Marketplace list → select test-mp
    stdin.write('\x1B[B'); // Down to "test-mp"
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    // Marketplace action → Browse plugins
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 100));
    // Browse → select installed "my-plugin"
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    // Should show uninstall action, not install scope
    expect(lastFrame()!).toContain('Uninstall');
    expect(lastFrame()!).not.toContain('User scope');
  });

  // Regression: uninstalled plugin in browse shows install scope selection
  it('selecting uninstalled plugin in browse shows install scope', async () => {
    const cbs = mockCallbacks();
    cbs.marketplaceList = vi.fn().mockResolvedValue([{ name: 'test-mp', type: 'github' }]);
    cbs.listAvailablePlugins = vi
      .fn()
      .mockResolvedValue([{ name: 'new-plugin', description: 'Not installed', installed: false }]);
    const { stdin, lastFrame } = render(<PluginTUI callbacks={cbs} onClose={() => {}} />);
    // Main → Marketplace
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 100));
    // Marketplace list → select test-mp
    stdin.write('\x1B[B');
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    // Marketplace action → Browse plugins
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 100));
    // Browse → select "new-plugin"
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    // Should show install scope, not uninstall
    expect(lastFrame()!).toContain('User scope');
    expect(lastFrame()!).toContain('Project scope');
  });

  // Regression: install passes name@marketplace format to callback
  it('install callback receives pluginId in name@marketplace format', async () => {
    const cbs = mockCallbacks();
    cbs.marketplaceList = vi.fn().mockResolvedValue([{ name: 'test-mp', type: 'github' }]);
    cbs.listAvailablePlugins = vi
      .fn()
      .mockResolvedValue([{ name: 'new-plugin', description: 'A plugin', installed: false }]);
    const { stdin } = render(<PluginTUI callbacks={cbs} onClose={() => {}} />);
    // Main → Marketplace → test-mp → Browse → new-plugin → User scope
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('\x1B[B');
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('\r'); // Browse plugins
    await new Promise((r) => setTimeout(r, 100));
    stdin.write('\r'); // new-plugin
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('\r'); // User scope
    await new Promise((r) => setTimeout(r, 100));
    expect(cbs.install).toHaveBeenCalledWith('new-plugin@test-mp', 'user');
  });
});
