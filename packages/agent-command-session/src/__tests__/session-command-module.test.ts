import { describe, expect, it, vi } from 'vitest';
import type { ICommandHostContext, ICommandSessionRuntime } from '@robota-sdk/agent-sdk';
import { InteractiveSession, SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createSessionCommandModule } from '../session-command-module.js';

function createRuntime(): ICommandSessionRuntime {
  return {
    clearHistory: vi.fn(),
    compact: async () => undefined,
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 0,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    getPermissionMode: () => 'default',
    setPermissionMode: () => undefined,
    getSessionId: () => 'session_1',
    getMessageCount: () => 0,
    getSessionAllowedTools: () => [],
  };
}

function createCommandContext(): ICommandHostContext {
  const runtime = createRuntime();
  return {
    getSession: () => runtime,
    getContextState: () => runtime.getContextState(),
    getAutoCompactThreshold: () => 0.835,
    compactContext: async () => undefined,
    getCwd: () => '/workspace',
    listEditCheckpoints: () => [],
    restoreEditCheckpoint: async () => {
      throw new Error('not used');
    },
    rollbackEditCheckpoint: async () => {
      throw new Error('not used');
    },
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: () => undefined,
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: async (taskId) => ({ taskId, lines: [] }),
    cancelBackgroundTask: async () => undefined,
    closeBackgroundTask: async () => undefined,
  };
}

describe('createSessionCommandModule', () => {
  it('provides clear metadata and user-only executable command from one module owner', () => {
    const module = createSessionCommandModule();
    const command = module.systemCommands?.find((item) => item.name === 'clear');
    const entry = module.commandSources?.[0]?.getCommands().find((item) => item.name === 'clear');

    expect(module.name).toBe('agent-command-session');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'clear',
        description: 'Clear conversation history',
        source: 'session',
        modelInvocable: false,
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        name: 'clear',
        lifecycle: 'inline',
        userInvocable: true,
        modelInvocable: false,
      }),
    );
  });

  it('provides rename metadata and user-only executable command from the same module owner', () => {
    const module = createSessionCommandModule();
    const command = module.systemCommands?.find((item) => item.name === 'rename');
    const entry = module.commandSources?.[0]?.getCommands().find((item) => item.name === 'rename');

    expect(module.commandSources?.[0]?.getCommands().map((item) => item.name)).toEqual([
      'clear',
      'rename',
      'resume',
    ]);
    expect(module.systemCommands?.map((item) => item.name)).toEqual(['clear', 'rename', 'resume']);
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'rename',
        description: 'Rename the current session',
        source: 'session',
        modelInvocable: false,
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        name: 'rename',
        lifecycle: 'inline',
        userInvocable: true,
        modelInvocable: false,
      }),
    );
  });

  it('provides resume metadata and user-only executable command from the same module owner', () => {
    const module = createSessionCommandModule();
    const command = module.systemCommands?.find((item) => item.name === 'resume');
    const entry = module.commandSources?.[0]?.getCommands().find((item) => item.name === 'resume');

    expect(entry).toEqual(
      expect.objectContaining({
        name: 'resume',
        description: 'Resume a previous session',
        source: 'session',
        modelInvocable: false,
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        name: 'resume',
        lifecycle: 'inline',
        userInvocable: true,
        modelInvocable: false,
      }),
    );
  });

  it('clears conversation history through the session command API', async () => {
    const clearConversationHistory = vi.fn();
    const context = {
      ...createCommandContext(),
      clearConversationHistory,
    };
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('clear', context, '');

    expect(clearConversationHistory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      message: 'Conversation cleared.',
      effects: [{ type: 'conversation-history-cleared' }],
    });
  });

  it('falls back to runtime clearHistory when the host has not implemented the richer API', async () => {
    const runtime = createRuntime();
    const context = {
      ...createCommandContext(),
      getSession: () => runtime,
    };
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('clear', context, '');

    expect(runtime.clearHistory).toHaveBeenCalledTimes(1);
    expect(result?.success).toBe(true);
  });

  it('clears InteractiveSession history when executed through a composed session', async () => {
    const clearHistory = vi.fn();
    const runtime = {
      ...createRuntime(),
      clearHistory,
      run: vi.fn().mockResolvedValue('answer'),
      abort: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      injectMessage: vi.fn(),
      getSystemMessage: vi.fn().mockReturnValue('system'),
      getToolSchemas: vi.fn().mockReturnValue([]),
    };
    const session = new InteractiveSession({
      session: runtime as never,
      commandModules: [createSessionCommandModule()],
    });
    await session.submit('hello');
    expect(session.getFullHistory().length).toBeGreaterThan(0);

    const result = await session.executeCommand('clear', '');

    expect(result).toEqual({
      success: true,
      message: 'Conversation cleared.',
      effects: [{ type: 'conversation-history-cleared' }],
    });
    expect(clearHistory).toHaveBeenCalledTimes(1);
    expect(session.getFullHistory()).toEqual([]);
  });

  it('renames the current session through a typed host effect', async () => {
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('rename', createCommandContext(), ' my-session ');

    expect(result).toEqual({
      success: true,
      message: 'Session renamed to "my-session".',
      data: { name: 'my-session' },
      effects: [{ type: 'session-renamed', name: 'my-session' }],
    });
  });

  it('returns usage when rename is missing a session name', async () => {
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('rename', createCommandContext(), '  ');

    expect(result).toEqual({
      success: false,
      message: 'Usage: rename <name>',
    });
  });

  it('requests the host session picker through a typed effect', async () => {
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('resume', createCommandContext(), '');

    expect(result).toEqual({
      success: true,
      message: 'Opening session picker...',
      data: { triggerResumePicker: true },
      effects: [{ type: 'session-picker-requested' }],
    });
  });
});
