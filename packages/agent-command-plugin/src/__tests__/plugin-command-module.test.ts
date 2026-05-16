import type {
  ICommandHostContext,
  ICommandPluginAdapter,
  ICommandSessionRuntime,
} from '@robota-sdk/agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createPluginCommandModule } from '../plugin-command-module.js';
import { executePluginCommand, executeReloadPluginsCommand } from '../plugin-command.js';

function createPluginAdapter(overrides?: Partial<ICommandPluginAdapter>): ICommandPluginAdapter {
  return {
    listInstalled: vi.fn().mockResolvedValue([]),
    listAvailablePlugins: vi.fn().mockResolvedValue([]),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    enable: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn().mockResolvedValue(undefined),
    marketplaceAdd: vi.fn().mockResolvedValue('community'),
    marketplaceRemove: vi.fn().mockResolvedValue(undefined),
    marketplaceUpdate: vi.fn().mockResolvedValue(undefined),
    marketplaceList: vi.fn().mockResolvedValue([]),
    reloadPlugins: vi.fn().mockResolvedValue({ loadedPluginCount: 2 }),
    ...overrides,
  };
}

function createCommandSessionRuntime(): ICommandSessionRuntime {
  return {
    clearHistory: () => undefined,
    compact: async () => undefined,
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 10,
      usedPercentage: 10,
      remainingPercentage: 90,
    }),
    getPermissionMode: () => 'default',
    setPermissionMode: () => undefined,
    getSessionId: () => 'session_1',
    getMessageCount: () => 0,
    getSessionAllowedTools: () => [],
    getAutoCompactThreshold: () => false,
  };
}

function createCommandHostContext(adapter?: ICommandPluginAdapter): ICommandHostContext {
  const checkpoint = {
    id: 'checkpoint_1',
    sessionId: 'session_1',
    sequence: 1,
    prompt: 'prompt',
    createdAt: '2026-05-03T00:00:00.000Z',
    fileCount: 0,
  };
  return {
    getSession: () => createCommandSessionRuntime(),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 10,
      usedPercentage: 10,
      remainingPercentage: 90,
    }),
    getAutoCompactThreshold: () => 0.8,
    getCommandHostAdapters: () => (adapter === undefined ? {} : { plugin: adapter }),
    compactContext: async () => undefined,
    getCwd: () => '/workspace',
    listCommands: () => [],
    listEditCheckpoints: () => [],
    restoreEditCheckpoint: async () => ({
      target: checkpoint,
      restoredCheckpointCount: 0,
      restoredFileCount: 0,
      removedCheckpointCount: 0,
    }),
    rollbackEditCheckpoint: async () => ({
      target: checkpoint,
      restoredCheckpointCount: 0,
      restoredFileCount: 0,
      removedCheckpointCount: 0,
    }),
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: () => undefined,
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: async (taskId) => ({ taskId, lines: [] }),
    cancelBackgroundTask: async () => undefined,
    closeBackgroundTask: async () => undefined,
  };
}

describe('createPluginCommandModule', () => {
  it('contributes plugin command metadata and executable commands', () => {
    const module = createPluginCommandModule();

    expect(module.name).toBe('agent-command-plugin');
    expect(module.commandSources?.[0]?.getCommands()).toEqual([
      expect.objectContaining({
        name: 'plugin',
        description: 'Manage plugins',
        source: 'plugin-manager',
        modelInvocable: false,
        argumentHint: expect.stringContaining('install'),
      }),
      expect.objectContaining({
        name: 'reload-plugins',
        description: 'Reload all plugin resources',
        source: 'plugin-manager',
        modelInvocable: false,
      }),
    ]);
    expect(module.systemCommands?.map((command) => command.name)).toEqual([
      'plugin',
      'reload-plugins',
    ]);
    expect(module.systemCommands?.[0]?.lifecycle).toBe('inline');
  });
});

describe('executePluginCommand', () => {
  it('opens the host plugin manager for empty args', async () => {
    await expect(executePluginCommand(createCommandHostContext(), '')).resolves.toEqual({
      success: true,
      message: 'Opening plugin manager...',
      effects: [{ type: 'plugin-tui-requested' }],
    });
  });

  it('returns unavailable when an operation needs a missing adapter', async () => {
    await expect(
      executePluginCommand(createCommandHostContext(), 'install demo@community'),
    ).resolves.toEqual({
      success: false,
      message: 'Plugin management is not available.',
    });
  });

  it('installs plugins through the adapter', async () => {
    const adapter = createPluginAdapter();

    await expect(
      executePluginCommand(createCommandHostContext(adapter), 'install demo@community'),
    ).resolves.toEqual({
      success: true,
      message: 'Installed plugin: demo@community',
    });
    expect(adapter.install).toHaveBeenCalledWith('demo@community');
  });

  it('lists marketplaces through the adapter', async () => {
    const adapter = createPluginAdapter({
      marketplaceList: vi.fn().mockResolvedValue([{ name: 'community', type: 'git' }]),
    });

    const result = await executePluginCommand(
      createCommandHostContext(adapter),
      'marketplace list',
    );

    expect(result).toEqual({
      success: true,
      message: 'Marketplace sources:\n  community (git)',
    });
    expect(adapter.marketplaceList).toHaveBeenCalled();
  });

  it('reports adapter errors as command failures', async () => {
    const adapter = createPluginAdapter({
      enable: vi.fn().mockRejectedValue(new Error('not installed')),
    });

    await expect(
      executePluginCommand(createCommandHostContext(adapter), 'enable missing@community'),
    ).resolves.toEqual({
      success: false,
      message: 'Plugin error: not installed',
    });
  });

  it('returns usage for incomplete subcommands', async () => {
    await expect(executePluginCommand(createCommandHostContext(), 'disable')).resolves.toEqual({
      success: false,
      message: 'Usage: /plugin disable <name>@<marketplace>',
    });
  });
});

describe('executeReloadPluginsCommand', () => {
  it('reloads plugins through the adapter and requests registry refresh', async () => {
    const adapter = createPluginAdapter({
      reloadPlugins: vi.fn().mockResolvedValue({ loadedPluginCount: 3 }),
    });

    await expect(
      executeReloadPluginsCommand(createCommandHostContext(adapter), ''),
    ).resolves.toEqual({
      success: true,
      message: 'Reloaded 3 plugin resources.',
      effects: [{ type: 'plugin-registry-reload-requested' }],
    });
    expect(adapter.reloadPlugins).toHaveBeenCalled();
  });

  it('reports reload failures instead of returning placeholder success', async () => {
    const adapter = createPluginAdapter({
      reloadPlugins: vi.fn().mockRejectedValue(new Error('manifest failed')),
    });

    await expect(
      executeReloadPluginsCommand(createCommandHostContext(adapter), ''),
    ).resolves.toEqual({
      success: false,
      message: 'Plugin error: manifest failed',
    });
  });
});
