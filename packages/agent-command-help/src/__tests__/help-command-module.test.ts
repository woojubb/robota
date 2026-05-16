import type { ICommandHostContext, ICommandSessionRuntime } from '@robota-sdk/agent-sdk';
import { describe, expect, it } from 'vitest';
import { createHelpCommandModule } from '../help-command-module.js';
import { executeHelpCommand } from '../help-command.js';

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

function createCommandHostContext(): ICommandHostContext {
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
    compactContext: async () => undefined,
    getCwd: () => '/workspace',
    listCommands: () => [
      { name: 'help', description: 'Show available commands' },
      { name: 'provider', description: 'Manage provider profiles' },
      { name: 'plugin', description: 'Manage plugins' },
    ],
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

describe('createHelpCommandModule', () => {
  it('contributes help command metadata and executable command', () => {
    const module = createHelpCommandModule();

    expect(module.name).toBe('agent-command-help');
    expect(module.commandSources?.[0]?.getCommands()).toEqual([
      {
        name: 'help',
        description: 'Show available commands',
        source: 'help',
        modelInvocable: false,
      },
    ]);
    expect(module.systemCommands?.map((command) => command.name)).toEqual(['help']);
    expect(module.systemCommands?.[0]?.lifecycle).toBe('inline');
    expect(module.systemCommands?.[0]?.modelInvocable).toBe(false);
  });
});

describe('executeHelpCommand', () => {
  it('renders the composed command list from the host context', () => {
    const result = executeHelpCommand(createCommandHostContext(), '');

    expect(result).toEqual({
      success: true,
      message: [
        'Available commands:',
        '  help             — Show available commands',
        '  provider         — Manage provider profiles',
        '  plugin           — Manage plugins',
      ].join('\n'),
    });
  });
});
