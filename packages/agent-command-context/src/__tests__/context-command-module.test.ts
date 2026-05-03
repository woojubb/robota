import { describe, expect, it, vi } from 'vitest';
import type { ICommandHostContext, ICommandSessionRuntime } from '@robota-sdk/agent-sdk';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createContextCommandModule } from '../context-command-module.js';

type TContextWindowState = ReturnType<ICommandHostContext['getContextState']>;
type TPermissionMode = ReturnType<ICommandSessionRuntime['getPermissionMode']>;

const CONTEXT_STATE: TContextWindowState = {
  usedTokens: 5000,
  maxTokens: 200000,
  usedPercentage: 2.5,
  remainingPercentage: 97.5,
};

function createRuntime(): ICommandSessionRuntime {
  let mode: TPermissionMode = 'default';
  return {
    clearHistory: vi.fn(),
    compact: vi.fn().mockResolvedValue(undefined),
    getContextState: () => CONTEXT_STATE,
    getPermissionMode: () => mode,
    setPermissionMode: (nextMode) => {
      mode = nextMode;
    },
    getSessionId: () => 'session_1',
    getMessageCount: () => 1,
    getSessionAllowedTools: () => [],
    getAutoCompactThreshold: () => 0.835,
  };
}

function createCommandHostContext(threshold: number | false = 0.835): ICommandHostContext {
  const runtime = createRuntime();
  return {
    getSession: () => runtime,
    getContextState: () => CONTEXT_STATE,
    getAutoCompactThreshold: () => threshold,
    compactContext: vi.fn(),
    getCwd: () => '/workspace',
    listCommands: () => [],
    listEditCheckpoints: () => [],
    restoreEditCheckpoint: vi.fn(),
    rollbackEditCheckpoint: vi.fn(),
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: vi.fn(),
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: vi.fn().mockResolvedValue({ taskId: 'task_1', lines: [] }),
    cancelBackgroundTask: vi.fn(),
    closeBackgroundTask: vi.fn(),
  };
}

function createExecutor(): SystemCommandExecutor {
  return new SystemCommandExecutor([...(createContextCommandModule().systemCommands ?? [])]);
}

describe('createContextCommandModule', () => {
  it('provides context metadata and an executable command', () => {
    const module = createContextCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-context');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'context',
        description: 'Context window info',
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        name: 'context',
        modelInvocable: false,
      }),
    );
  });

  it('formats context usage and enabled auto compact policy', async () => {
    const result = await createExecutor().execute('context', createCommandHostContext(0.75), '');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Context: 5,000 / 200,000 tokens (3%)');
    expect(result?.message).toContain('Auto compact: 75%');
    expect(result?.data).toEqual({
      usedTokens: 5000,
      maxTokens: 200000,
      percentage: 2.5,
      autoCompactThreshold: 0.75,
    });
  });

  it('formats disabled auto compact policy', async () => {
    const result = await createExecutor().execute('context', createCommandHostContext(false), '');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Auto compact: disabled');
    expect(result?.data?.autoCompactThreshold).toBe(false);
  });
});
