import {
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { ICommandHostContext, ICommandSessionRuntime } from '@robota-sdk/agent-framework';
import { InteractiveSession, SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createSessionCommandModule } from '../session-command-module.js';
import {
  createTestCommandHost,
  createTestSessionRuntime,
} from '@robota-sdk/agent-framework/testing';

function createRuntime() {
  return createTestSessionRuntime({
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
    getMessageCount: () => 5,
    getSessionAllowedTools: () => [],
    getAutoCompactThreshold: () => false,
    getFullHistory: () => [],
    getHistory: () => [],
  });
}

function createCommandContext() {
  const runtime = createRuntime();
  return createTestCommandHost({
    overrides: {
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
    },
  });
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
      'cost',
      'validate-session',
    ]);
    expect(module.systemCommands?.map((item) => item.name)).toEqual([
      'clear',
      'rename',
      'resume',
      'cost',
      'validate-session',
    ]);
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

  it('provides cost metadata and user-only executable command from the same module owner', () => {
    const module = createSessionCommandModule();
    const command = module.systemCommands?.find((item) => item.name === 'cost');
    const entry = module.commandSources?.[0]?.getCommands().find((item) => item.name === 'cost');

    expect(entry).toEqual(
      expect.objectContaining({
        name: 'cost',
        description: expect.stringContaining('token usage'),
        source: 'session',
        modelInvocable: false,
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        name: 'cost',
        lifecycle: 'inline',
        userInvocable: true,
        modelInvocable: false,
      }),
    );
  });

  it('provides validate-session metadata and user-only executable command from the same module owner', () => {
    const module = createSessionCommandModule();
    const command = module.systemCommands?.find((item) => item.name === 'validate-session');
    const entry = module.commandSources?.[0]
      ?.getCommands()
      .find((item) => item.name === 'validate-session');

    expect(entry).toEqual(
      expect.objectContaining({
        name: 'validate-session',
        description: 'Validate current session replay log',
        source: 'session',
        modelInvocable: false,
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        name: 'validate-session',
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
    });
  });

  it('CMD-004: confirms before clearing and proceeds on yes', async () => {
    const clearConversationHistory = vi.fn();
    const context = {
      ...createCommandContext(),
      clearConversationHistory,
      getUserInteraction: () => ({
        ask: async () => ({ type: 'answer' as const, values: ['yes'] }),
      }),
    };
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('clear', context, '');

    expect(clearConversationHistory).toHaveBeenCalledTimes(1);
    expect(result?.success).toBe(true);
  });

  it('CMD-004: cancels the clear when the user declines', async () => {
    const clearConversationHistory = vi.fn();
    const context = {
      ...createCommandContext(),
      clearConversationHistory,
      getUserInteraction: () => ({
        ask: async () => ({ type: 'answer' as const, values: ['no'] }),
      }),
    };
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('clear', context, '');

    expect(clearConversationHistory).not.toHaveBeenCalled();
    expect(result?.message).toBe('Clear cancelled.');
  });

  it('ARCH-029 TC-09: /clear takes the host path only — it never reaches past it into the runtime', async () => {
    // The deleted fallback called `getSession().clearHistory()` when the host member was absent.
    // Those are not the same operation: the host's clear also broadcasts `history_cleared` to
    // every attached surface (CMD-004 Stage E), so the fallback cleared ONE surface and left the
    // others still showing the transcript. With the member required there is one path, and this
    // pins that the runtime is not reached behind the host's back.
    const runtime = createRuntime();
    const clearConversationHistory = vi.fn();
    const context = {
      ...createCommandContext(),
      getSession: () => runtime,
      clearConversationHistory,
    };
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('clear', context, '');

    expect(clearConversationHistory).toHaveBeenCalledTimes(1);
    expect(runtime.clearHistory).not.toHaveBeenCalled();
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
      // SELFHOST-004 P6: the span collector subscribes to the session bus each turn.
      getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
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
      hostActions: [{ type: 'session-rename', name: 'my-session' }],
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
      uiIntents: [{ type: 'show-session-picker' }],
    });
  });

  it('shows session info through the session command API (no token data yet)', async () => {
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('cost', createCommandContext(), '');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('session_1');
    expect(result?.message).toContain('Messages: 5');
    expect(result?.message).toContain('not yet available');
  });

  it('shows token counts and estimated cost when session has usage data', async () => {
    const runtime = {
      ...createRuntime(),
      getSessionTokenUsage: () => ({ inputTokens: 45_000, outputTokens: 12_000 }),
      getModelId: () => 'claude-sonnet-4-5',
    };
    const context = { ...createCommandContext(), getSession: () => runtime };
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('cost', context, '');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('45,000');
    expect(result?.message).toContain('12,000');
    expect(result?.message).toContain('$');
    expect((result?.data as Record<string, unknown>)?.inputTokens).toBe(45_000);
    expect((result?.data as Record<string, unknown>)?.outputTokens).toBe(12_000);
    expect((result?.data as Record<string, unknown>)?.estimatedCostUsd).toBeDefined();
  });

  it('sets a monthly budget via /cost budget subcommand', async () => {
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);
    const context = { ...createCommandContext(), getCwd: () => '/tmp/robota-test-budget' };

    const result = await executor.execute('cost', context, 'budget 5.00');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('$5.00');
  });

  it('clearing a budget writes an empty document without checking first (CodeQL js/file-system-race)', async () => {
    // The `existsSync` this replaced was a check-then-use window: swapping the path for a symlink
    // between the check and the write made the write land on the symlink's target. There is no
    // window now because there is no check — and no check is safe to remove here precisely because
    // `readBudget` reads an absent file and an empty document identically.
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);
    const cwd = mkdtempSync(join(tmpdir(), 'robota-budget-clear-'));
    try {
      const context = { ...createCommandContext(), getCwd: () => cwd };

      // clearing a project that never had the file must succeed, not throw on the missing path
      const first = await executor.execute('cost', context, 'budget clear');
      expect(first?.success).toBe(true);
      expect(readFileSync(join(cwd, '.robota/budget.json'), 'utf-8')).toBe('{}');

      await executor.execute('cost', context, 'budget 5.00');
      const second = await executor.execute('cost', context, 'budget clear');
      expect(second?.success).toBe(true);
      expect(readFileSync(join(cwd, '.robota/budget.json'), 'utf-8')).toBe('{}');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(constants.O_NOFOLLOW === undefined)(
    'refuses to write the budget through a symbolic link, naming why',
    async () => {
      // Removing the race is not the same as removing the redirection: a symlink planted BEFORE the
      // call is still followed by a plain write. This is the case that pins the second half — and it
      // is skipped rather than silently weakened on a platform with no O_NOFOLLOW, because a test
      // that passes by not testing is worse than one that says it did not run.
      const executor = new SystemCommandExecutor([
        ...(createSessionCommandModule().systemCommands ?? []),
      ]);
      const cwd = mkdtempSync(join(tmpdir(), 'robota-budget-symlink-'));
      try {
        const outside = join(cwd, 'outside.txt');
        writeFileSync(outside, 'ORIGINAL');
        mkdirSync(join(cwd, '.robota'), { recursive: true });
        symlinkSync(outside, join(cwd, '.robota/budget.json'));
        const context = { ...createCommandContext(), getCwd: () => cwd };

        for (const args of ['budget clear', 'budget 5.00']) {
          const result = await executor.execute('cost', context, args);
          expect(result?.success).toBe(false);
          expect(result?.message).toContain('symbolic link');
          // the point of the whole change: the target is untouched
          expect(readFileSync(outside, 'utf-8')).toBe('ORIGINAL');
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it('rejects invalid budget amount', async () => {
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('cost', createCommandContext(), 'budget notanumber');

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('Usage:');
  });

  it('validates the current session replay log through the SDK common API', async () => {
    const executor = new SystemCommandExecutor([
      ...(createSessionCommandModule().systemCommands ?? []),
    ]);
    const context = {
      ...createCommandContext(),
      validateCurrentSessionReplayLog: () => ({
        logFile: '/workspace/.robota/logs/session_1.jsonl',
        entryCount: 2,
        validation: {
          ok: false,
          issues: [
            {
              code: 'PROVIDER_NATIVE_RAW_PAYLOAD_MISSING' as const,
              message: 'Provider request exec-1:1 has no provider-native payload.',
              executionId: 'exec-1',
              round: 1,
            },
          ],
        },
      }),
    };

    const result = await executor.execute('validate-session', context, '');

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('PROVIDER_NATIVE_RAW_PAYLOAD_MISSING');
    expect(result?.data).toEqual({
      logFile: '/workspace/.robota/logs/session_1.jsonl',
      entryCount: 2,
      issueCount: 1,
      ok: false,
    });
  });
});
