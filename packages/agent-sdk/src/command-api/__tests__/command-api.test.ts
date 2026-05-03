import type { IContextWindowState, TPermissionMode } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';
import type {
  ICommandHostContext,
  ICommandResult,
  ICommandSessionRuntime,
  ISystemCommand,
} from '../index.js';
import { buildProviderProfile, formatEnvReference, validateProviderProfile } from '../index.js';
import type { IEditCheckpointRestoreResult } from '../../checkpoints/index.js';

const CONTEXT_STATE: IContextWindowState = {
  maxTokens: 100,
  usedTokens: 25,
  usedPercentage: 25,
  remainingPercentage: 75,
};

function createCommandSessionRuntime(): ICommandSessionRuntime {
  let mode: TPermissionMode = 'default';
  return {
    clearHistory: () => undefined,
    compact: async () => undefined,
    getContextState: () => CONTEXT_STATE,
    getPermissionMode: () => mode,
    setPermissionMode: (nextMode) => {
      mode = nextMode;
    },
    getSessionId: () => 'session_1',
    getMessageCount: () => 2,
    getSessionAllowedTools: () => [],
    getAutoCompactThreshold: () => 0.8,
  };
}

function createCheckpointResult(): IEditCheckpointRestoreResult {
  const target = {
    id: 'checkpoint_1',
    sessionId: 'session_1',
    sequence: 1,
    prompt: 'edit files',
    createdAt: '2026-05-03T00:00:00.000Z',
    fileCount: 1,
  };
  return {
    target,
    restoredCheckpointCount: 1,
    restoredFileCount: 1,
    removedCheckpointCount: 0,
  };
}

function createCommandHostContext(): ICommandHostContext {
  const runtime = createCommandSessionRuntime();
  return {
    getSession: () => runtime,
    getContextState: () => CONTEXT_STATE,
    getAutoCompactThreshold: () => 0.8,
    compactContext: async () => undefined,
    getCwd: () => '/workspace',
    listCommands: () => [{ name: 'example', description: 'Example command' }],
    listEditCheckpoints: () => [],
    restoreEditCheckpoint: async () => createCheckpointResult(),
    rollbackEditCheckpoint: async () => createCheckpointResult(),
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: () => undefined,
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: async (taskId) => ({ taskId, lines: [] }),
    cancelBackgroundTask: async () => undefined,
    closeBackgroundTask: async () => undefined,
  };
}

describe('command-api contracts', () => {
  it('executes commands against the narrow command host context', async () => {
    const command: ISystemCommand = {
      name: 'example',
      description: 'Example command',
      execute: (context): ICommandResult => ({
        success: true,
        message: context.getSession().getSessionId(),
        data: {
          usedTokens: context.getContextState().usedTokens,
          cwd: context.getCwd(),
        },
      }),
    };

    const result = await command.execute(createCommandHostContext(), '');

    expect(result).toEqual({
      success: true,
      message: 'session_1',
      data: {
        usedTokens: 25,
        cwd: '/workspace',
      },
    });
  });

  it('exposes provider common APIs without command implementation imports', () => {
    const profile = buildProviderProfile({
      profile: 'openai-main',
      type: 'openai',
      model: 'gpt-5.1',
      apiKeyEnv: 'OPENAI_API_KEY',
    });

    expect(profile.apiKey).toBe(formatEnvReference('OPENAI_API_KEY'));
    expect(() => validateProviderProfile('openai-main', profile)).not.toThrow();
  });
});
