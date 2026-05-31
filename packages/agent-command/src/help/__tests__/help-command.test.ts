import type {
  ICommandHostContext,
  ICommandListEntry,
  ICommandSessionRuntime,
} from '@robota-sdk/agent-framework';
import { formatCommandHelpMessage } from '@robota-sdk/agent-framework';
import { describe, expect, it } from 'vitest';

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
    getFullHistory: () => [],
  };
}

function createCheckpoint() {
  return {
    id: 'checkpoint_1',
    sessionId: 'session_1',
    sequence: 1,
    prompt: 'prompt',
    createdAt: '2026-05-25T00:00:00.000Z',
    fileCount: 0,
  };
}

function buildContext(commands: ICommandListEntry[]): ICommandHostContext {
  const checkpoint = createCheckpoint();
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
    listCommands: () => commands,
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

describe('formatCommandHelpMessage — example field', () => {
  it('TC-01: includes Example line for compact command', () => {
    const context = buildContext([
      {
        name: 'compact',
        displayName: 'Compact Context',
        description: 'Compress context window',
        example: '/compact Summarize the current context',
      },
    ]);

    const output = formatCommandHelpMessage(context);

    expect(output).toContain('Example: /compact Summarize the current context');
  });

  it('TC-02: includes Example line for provider command', () => {
    const context = buildContext([
      {
        name: 'provider',
        displayName: 'Provider Setup',
        description: 'Manage provider profiles',
        example: '/provider switch production',
      },
    ]);

    const output = formatCommandHelpMessage(context);

    expect(output).toContain('Example: /provider switch production');
  });

  it('TC-03: omits Example line for commands without example', () => {
    const context = buildContext([
      {
        name: 'help',
        displayName: 'Help',
        description: 'Show available commands',
      },
    ]);

    const output = formatCommandHelpMessage(context);

    expect(output).not.toContain('Example:');
  });
});
