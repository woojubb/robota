import { describe, it, expect, vi } from 'vitest';
import type { IPluginCallbacks } from '../slash-executor.js';
import { handlePluginCommand, handleReloadPlugins } from '../slash-executor.js';
import { PluginCommandSource } from '../plugin-source.js';
import type { ILoadedBundlePlugin } from '@robota-sdk/agent-sdk';

function createMockAddMessage(): {
  addMessage: (msg: { role: string; content: string }) => void;
  messages: Array<{ role: string; content: string }>;
} {
  const messages: Array<{ role: string; content: string }> = [];
  return {
    addMessage: (msg) => messages.push(msg),
    messages,
  };
}

function createMockPluginCallbacks(overrides?: Partial<IPluginCallbacks>): IPluginCallbacks {
  return {
    listInstalled: vi.fn().mockResolvedValue([]),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    enable: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn().mockResolvedValue(undefined),
    marketplaceAdd: vi.fn().mockResolvedValue(undefined),
    marketplaceList: vi.fn().mockResolvedValue([]),
    reloadPlugins: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handlePluginCommand', () => {
  it('should list installed plugins when no subcommand', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks({
      listInstalled: vi.fn().mockResolvedValue([
        { name: 'test-plugin', description: 'A test plugin', enabled: true },
        { name: 'other-plugin', description: 'Another plugin', enabled: false },
      ]),
    });

    const result = await handlePluginCommand('', addMessage, callbacks);

    expect(result.handled).toBe(true);
    expect(callbacks.listInstalled).toHaveBeenCalled();
    expect(messages[0]!.content).toContain('test-plugin');
    expect(messages[0]!.content).toContain('other-plugin');
    expect(messages[0]!.content).toContain('enabled');
    expect(messages[0]!.content).toContain('disabled');
  });

  it('should show empty message when no plugins installed', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    const result = await handlePluginCommand('', addMessage, callbacks);

    expect(result.handled).toBe(true);
    expect(messages[0]!.content).toContain('No plugins installed');
  });

  it('should handle install command', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    const result = await handlePluginCommand(
      'install my-plugin@marketplace1',
      addMessage,
      callbacks,
    );

    expect(result.handled).toBe(true);
    expect(callbacks.install).toHaveBeenCalledWith('my-plugin@marketplace1');
    expect(messages[0]!.content).toContain('my-plugin@marketplace1');
  });

  it('should show usage when install has no argument', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    const result = await handlePluginCommand('install', addMessage, callbacks);

    expect(result.handled).toBe(true);
    expect(callbacks.install).not.toHaveBeenCalled();
    expect(messages[0]!.content).toContain('Usage');
  });

  it('should handle uninstall command', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    const result = await handlePluginCommand(
      'uninstall my-plugin@marketplace1',
      addMessage,
      callbacks,
    );

    expect(result.handled).toBe(true);
    expect(callbacks.uninstall).toHaveBeenCalledWith('my-plugin@marketplace1');
    expect(messages[0]!.content).toContain('Uninstalled');
  });

  it('should handle enable command', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    const result = await handlePluginCommand(
      'enable my-plugin@marketplace1',
      addMessage,
      callbacks,
    );

    expect(result.handled).toBe(true);
    expect(callbacks.enable).toHaveBeenCalledWith('my-plugin@marketplace1');
    expect(messages[0]!.content).toContain('Enabled');
  });

  it('should handle disable command', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    const result = await handlePluginCommand(
      'disable my-plugin@marketplace1',
      addMessage,
      callbacks,
    );

    expect(result.handled).toBe(true);
    expect(callbacks.disable).toHaveBeenCalledWith('my-plugin@marketplace1');
    expect(messages[0]!.content).toContain('Disabled');
  });

  it('should show usage when enable has no argument', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    await handlePluginCommand('enable', addMessage, callbacks);

    expect(callbacks.enable).not.toHaveBeenCalled();
    expect(messages[0]!.content).toContain('Usage');
  });

  it('should handle marketplace add command', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    const result = await handlePluginCommand(
      'marketplace add https://example.com/plugins',
      addMessage,
      callbacks,
    );

    expect(result.handled).toBe(true);
    expect(callbacks.marketplaceAdd).toHaveBeenCalledWith('https://example.com/plugins');
    expect(messages[0]!.content).toContain('Added marketplace');
  });

  it('should handle marketplace list command', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks({
      marketplaceList: vi.fn().mockResolvedValue([
        { name: 'official', type: 'registry' },
        { name: 'community', type: 'git' },
      ]),
    });

    const result = await handlePluginCommand('marketplace list', addMessage, callbacks);

    expect(result.handled).toBe(true);
    expect(callbacks.marketplaceList).toHaveBeenCalled();
    expect(messages[0]!.content).toContain('official');
    expect(messages[0]!.content).toContain('community');
  });

  it('should show empty message when no marketplaces configured', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    await handlePluginCommand('marketplace list', addMessage, callbacks);

    expect(messages[0]!.content).toContain('No marketplace');
  });

  it('should show usage for unknown marketplace subcommand', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    await handlePluginCommand('marketplace', addMessage, callbacks);

    expect(messages[0]!.content).toContain('Usage');
  });

  it('should show error for unknown plugin subcommand', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    await handlePluginCommand('unknown-sub', addMessage, callbacks);

    expect(messages[0]!.content).toContain('Unknown');
  });

  it('should handle errors from callbacks gracefully', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks({
      install: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    const result = await handlePluginCommand('install bad-plugin@mp', addMessage, callbacks);

    expect(result.handled).toBe(true);
    expect(messages[0]!.content).toContain('Network error');
  });
});

describe('handleReloadPlugins', () => {
  it('should call reloadPlugins callback', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const callbacks = createMockPluginCallbacks();

    const result = await handleReloadPlugins(addMessage, callbacks);

    expect(result.handled).toBe(true);
    expect(callbacks.reloadPlugins).toHaveBeenCalled();
    expect(messages[0]!.content).toContain('reload');
  });
});

describe('PluginCommandSource', () => {
  function createMockPlugin(
    name: string,
    skills: Array<{ name: string; description: string; skillContent: string }>,
  ): ILoadedBundlePlugin {
    return {
      manifest: {
        name,
        version: '1.0.0',
        description: `Plugin ${name}`,
        features: { skills: true },
      },
      skills,
      hooks: {},
      agents: [],
      pluginDir: `/plugins/${name}`,
    };
  }

  it('should expose plugin skills as namespaced commands', () => {
    const plugin = createMockPlugin('my-plugin', [
      { name: 'deploy', description: 'Deploy app', skillContent: '# Deploy' },
      { name: 'test', description: 'Run tests', skillContent: '# Test' },
    ]);

    const source = new PluginCommandSource([plugin]);
    const commands = source.getCommands();

    expect(commands).toHaveLength(2);
    expect(commands[0]!.name).toBe('deploy@my-plugin');
    expect(commands[0]!.description).toBe('Deploy app');
    expect(commands[0]!.source).toBe('plugin');
    expect(commands[0]!.skillContent).toBe('# Deploy');
    expect(commands[1]!.name).toBe('test@my-plugin');
  });

  it('should handle multiple plugins', () => {
    const plugin1 = createMockPlugin('plugin-a', [
      { name: 'skill-1', description: 'Skill 1', skillContent: '# S1' },
    ]);
    const plugin2 = createMockPlugin('plugin-b', [
      { name: 'skill-2', description: 'Skill 2', skillContent: '# S2' },
    ]);

    const source = new PluginCommandSource([plugin1, plugin2]);
    const commands = source.getCommands();

    expect(commands).toHaveLength(2);
    expect(commands[0]!.name).toBe('skill-1@plugin-a');
    expect(commands[1]!.name).toBe('skill-2@plugin-b');
  });

  it('should return empty array when no plugins', () => {
    const source = new PluginCommandSource([]);
    expect(source.getCommands()).toEqual([]);
  });

  it('should return empty array when plugins have no skills', () => {
    const plugin = createMockPlugin('empty-plugin', []);
    const source = new PluginCommandSource([plugin]);
    expect(source.getCommands()).toEqual([]);
  });

  it('should have name "plugin"', () => {
    const source = new PluginCommandSource([]);
    expect(source.name).toBe('plugin');
  });
});
