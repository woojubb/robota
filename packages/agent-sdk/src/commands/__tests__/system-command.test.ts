import { describe, it, expect, vi } from 'vitest';
import { BuiltinCommandSource, createBuiltinCommandModule } from '../builtin-source.js';
import { SystemCommandExecutor, createSystemCommands } from '../system-command.js';
import { formatCommandHelpMessage } from '../../command-api/help/help-command-api.js';
import type { InteractiveSession } from '../../interactive/interactive-session.js';
import type { ICommandModule } from '../../command-api/command-module.js';

function createMockSession(overrides?: Record<string, unknown>, cwd = '/workspace') {
  const underlying = {
    clearHistory: vi.fn(),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getMessageCount: vi.fn().mockReturnValue(5),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({
      usedTokens: 5000,
      maxTokens: 200000,
      usedPercentage: 2.5,
    }),
    getAutoCompactThreshold: vi.fn().mockReturnValue(0.835),
    compact: vi.fn(),
    listBackgroundTasks: vi.fn().mockReturnValue([]),
    cancelBackgroundTask: vi.fn(),
    closeBackgroundTask: vi.fn(),
    readBackgroundTaskLog: vi.fn().mockResolvedValue({ taskId: 'agent_1', lines: [] }),
    spawnAgentJob: vi.fn().mockResolvedValue({
      id: 'agent_1',
      type: 'Plan',
      label: 'Plan',
      parentSessionId: 'test-session-id',
      status: 'running',
      mode: 'background',
      depth: 1,
      cwd: '/workspace',
      promptPreview: 'draft architecture',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }),
    waitAgentJob: vi.fn(),
    listAgentJobs: vi.fn().mockReturnValue([]),
    listAgentDefinitions: vi.fn().mockReturnValue([
      { name: 'general-purpose', description: 'General-purpose task execution agent.' },
      { name: 'Plan', description: 'Read-only planning agent.' },
    ]),
    listEditCheckpoints: vi.fn().mockReturnValue([]),
    restoreEditCheckpoint: vi.fn(),
    rollbackEditCheckpoint: vi.fn(),
    sendAgentJob: vi.fn(),
    cancelAgentJob: vi.fn(),
    closeAgentJob: vi.fn(),
    ...overrides,
  };

  return {
    getSession: () => underlying,
    getContextState: underlying.getContextState,
    listBackgroundTasks: underlying.listBackgroundTasks,
    cancelBackgroundTask: underlying.cancelBackgroundTask,
    closeBackgroundTask: underlying.closeBackgroundTask,
    readBackgroundTaskLog: underlying.readBackgroundTaskLog,
    spawnAgentJob: underlying.spawnAgentJob,
    waitAgentJob: underlying.waitAgentJob,
    listAgentJobs: underlying.listAgentJobs,
    listAgentDefinitions: underlying.listAgentDefinitions,
    listEditCheckpoints: underlying.listEditCheckpoints,
    restoreEditCheckpoint: underlying.restoreEditCheckpoint,
    rollbackEditCheckpoint: underlying.rollbackEditCheckpoint,
    sendAgentJob: underlying.sendAgentJob,
    cancelAgentJob: underlying.cancelAgentJob,
    closeAgentJob: underlying.closeAgentJob,
    ...overrides,
    _underlying: underlying,
    getCwd: () => cwd,
  } as unknown as InteractiveSession;
}

describe('SystemCommandExecutor', () => {
  it('keeps SDK core built-in commands limited to SDK-owned discovery commands', () => {
    const executor = new SystemCommandExecutor();
    const commands = executor.listCommands();
    expect(commands.map((c) => c.name)).toEqual(['skills']);
    expect(commands.map((c) => c.name)).not.toContain('background');
    expect(commands.map((c) => c.name)).not.toContain('memory');
    expect(commands.map((c) => c.name)).not.toContain('cost');
    expect(commands.map((c) => c.name)).not.toContain('clear');
    expect(commands.map((c) => c.name)).not.toContain('rename');
    expect(commands.map((c) => c.name)).not.toContain('resume');
    expect(commands.map((c) => c.name)).not.toContain('permissions');
    expect(commands.map((c) => c.name)).not.toContain('language');
    expect(commands.map((c) => c.name)).not.toContain('mode');
    expect(commands.map((c) => c.name)).not.toContain('model');
    expect(commands.map((c) => c.name)).not.toContain('compact');
    expect(commands.map((c) => c.name)).not.toContain('context');
    expect(commands.map((c) => c.name)).not.toContain('reset');
    expect(commands.map((c) => c.name)).not.toContain('rewind');
  });

  it('exposes /skills as the SDK core model-invocable discovery command', () => {
    const executor = new SystemCommandExecutor();
    const modelCommands = executor.listModelInvocableCommands();

    expect(modelCommands.map((command) => command.name)).toEqual(['/skills']);
    expect(executor.isModelInvocable('skills')).toBe(true);
    expect(executor.isModelInvocable('memory')).toBe(false);
    expect(executor.isModelInvocable('agent')).toBe(false);
    expect(executor.isModelInvocable('reset')).toBe(false);
    expect(executor.isModelInvocable('rewind')).toBe(false);
  });

  it('returns registered skill metadata and activation guidance from /skills', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute(
      'skills',
      createMockSession({
        listSkills: vi.fn().mockReturnValue([
          {
            name: 'repo-writing',
            description: 'Repository writing rules',
            source: 'skill',
            modelInvocable: true,
            userInvocable: true,
          },
        ]),
      }),
      '',
    );

    expect(result).toMatchObject({
      success: true,
      message: expect.stringContaining('Registered skills:'),
    });
    expect(result?.message).toContain('repo-writing: Repository writing rules');
    expect(result?.message).toContain('Use ExecuteSkill with the exact skill name');
    expect(result?.data?.['activationContract']).toMatchObject({
      activateWith: 'ExecuteSkill',
      activationRequiredBeforeWorkflow: true,
    });
  });

  it('returns null for unknown command', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('nonexistent', createMockSession(), '');
    expect(result).toBeNull();
  });

  it('formats a composed command list through the SDK common API', () => {
    const session = createMockSession({
      listCommands: vi.fn().mockReturnValue([
        { name: 'help', description: 'Show available commands' },
        { name: 'provider', description: 'Manage provider profiles' },
      ]),
    });

    const result = formatCommandHelpMessage(session);

    expect(result).toBe(
      [
        'Available commands:',
        '  help             — Show available commands',
        '  provider         — Manage provider profiles',
      ].join('\n'),
    );
  });

  it('derives SDK built-in command palette metadata from executable system commands', () => {
    const module = createBuiltinCommandModule();
    const executableNames = module.systemCommands?.map((command) => command.name) ?? [];
    const paletteNames =
      module.commandSources?.flatMap((source) =>
        source.getCommands().map((command) => command.name),
      ) ?? [];

    expect(paletteNames).toEqual(executableNames);
    expect(paletteNames).not.toContain('provider');
    expect(paletteNames).not.toContain('plugin');
    expect(
      new BuiltinCommandSource(module.systemCommands).getCommands().map((c) => c.name),
    ).toEqual(executableNames);
  });

  it('register adds custom command', async () => {
    const executor = new SystemCommandExecutor();
    executor.register({
      name: 'custom',
      description: 'Custom command',
      execute: () => ({ message: 'custom result', success: true }),
    });
    expect(executor.hasCommand('custom')).toBe(true);
    const result = await executor.execute('custom', createMockSession(), '');
    expect(result!.message).toBe('custom result');
  });

  it('executes arbitrary injected command modules without knowing their names in SDK core', async () => {
    const module: ICommandModule = {
      name: 'diagnostics-command',
      systemCommands: [
        {
          name: 'diagnose',
          description: 'Run read-only diagnostics for the current workspace',
          modelInvocable: true,
          safety: 'read-only',
          execute: (_session, args) => ({
            message: `diagnosed ${args}`,
            success: true,
            data: { scope: args },
          }),
        },
      ],
    };
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);

    expect(executor.hasCommand('agent')).toBe(false);
    expect(executor.hasCommand('diagnose')).toBe(true);
    expect(executor.listModelInvocableCommands()).toEqual([
      expect.objectContaining({
        name: '/skills',
        kind: 'builtin-command',
        modelInvocable: true,
      }),
      {
        name: '/diagnose',
        kind: 'builtin-command',
        description: 'Run read-only diagnostics for the current workspace',
        userInvocable: true,
        modelInvocable: true,
        safety: 'read-only',
      },
    ]);

    const result = await executor.executeModelInvocable(
      'diagnose',
      createMockSession(),
      'workspace',
    );

    expect(result).toEqual({
      message: 'diagnosed workspace',
      success: true,
      data: { scope: 'workspace' },
    });
  });
});
