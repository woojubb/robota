import { describe, expect, it, vi } from 'vitest';
import type { ICommandHostContext, ICommandSessionRuntime } from '@robota-sdk/agent-sdk';
import { InteractiveSession, SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createCompactCommandModule } from '../compact-command-module.js';

type TContextWindowState = ReturnType<ICommandHostContext['getContextState']>;
type TPermissionMode = ReturnType<ICommandSessionRuntime['getPermissionMode']>;

const BEFORE_CONTEXT: TContextWindowState = {
  usedTokens: 80,
  maxTokens: 100,
  usedPercentage: 80,
  remainingPercentage: 20,
};

const AFTER_CONTEXT: TContextWindowState = {
  usedTokens: 35,
  maxTokens: 100,
  usedPercentage: 35,
  remainingPercentage: 65,
};

function createRuntime(): ICommandSessionRuntime {
  let mode: TPermissionMode = 'default';
  return {
    clearHistory: vi.fn(),
    compact: vi.fn().mockResolvedValue(undefined),
    getContextState: vi.fn().mockReturnValue(AFTER_CONTEXT),
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

function createCommandHostContext(): ICommandHostContext & {
  compactContext: ReturnType<typeof vi.fn>;
} {
  const runtime = createRuntime();
  const getContextState = vi
    .fn()
    .mockReturnValueOnce(BEFORE_CONTEXT)
    .mockReturnValue(AFTER_CONTEXT);
  return {
    getSession: () => runtime,
    getContextState,
    getAutoCompactThreshold: () => 0.835,
    compactContext: vi.fn().mockResolvedValue(undefined),
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

describe('createCompactCommandModule', () => {
  it('provides compact metadata and a blocking executable command', () => {
    const module = createCompactCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-compact');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'compact',
        description: 'Compress context window',
        argumentHint: '[instructions]',
        modelInvocable: true,
        safety: 'write',
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        name: 'compact',
        lifecycle: 'blocking',
        modelInvocable: true,
        safety: 'write',
      }),
    );
  });

  it('projects compact as a model-invocable descriptor through the command executor', () => {
    const executor = new SystemCommandExecutor([
      ...(createCompactCommandModule().systemCommands ?? []),
    ]);

    expect(executor.listModelInvocableCommands()).toEqual([
      {
        name: 'compact',
        kind: 'builtin-command',
        description: 'Compress context window',
        userInvocable: true,
        modelInvocable: true,
        argumentHint: '[instructions]',
        safety: 'write',
      },
    ]);
  });

  it('compacts context through the command host facade', async () => {
    const context = createCommandHostContext();
    const executor = new SystemCommandExecutor([
      ...(createCompactCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('compact', context, ' focus on tests ');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Context compacted: 80% -> 35%');
    expect(result?.data).toEqual({ before: 80, after: 35 });
    expect(context.compactContext).toHaveBeenCalledWith('focus on tests');
  });

  it('runs through InteractiveSession foreground lifecycle when composed', async () => {
    let resolveCompact: () => void;
    const runtime = createRuntime();
    const compact = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCompact = resolve;
        }),
    );
    const session = new InteractiveSession({
      session: {
        ...runtime,
        compact,
      } as never,
      commandModules: [createCompactCommandModule()],
    });
    const thinkingStates: boolean[] = [];
    session.on('thinking', (isThinking) => thinkingStates.push(isThinking));

    const pending = session.executeCommand('compact', 'focus on tests');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const blocked = await session.executeCommand('compact', '');

    expect(session.isExecuting()).toBe(true);
    expect(thinkingStates).toEqual([true]);
    expect(blocked?.success).toBe(false);
    expect(blocked?.message).toContain('already running');
    expect(compact).toHaveBeenCalledWith('focus on tests');

    resolveCompact!();
    const result = await pending;

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Context compacted');
    expect(session.isExecuting()).toBe(false);
    expect(thinkingStates).toEqual([true, false]);
  });
});
