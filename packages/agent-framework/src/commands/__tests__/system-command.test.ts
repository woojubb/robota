import { describe, it, expect, vi } from 'vitest';

import { formatCommandHelpMessage } from '../../command-api/help/help-command-api.js';
import { DuplicateSystemCommandSemanticRoleError } from '../../command-api/contracts.js';
import { BuiltinCommandSource, createBuiltinCommandModule } from '../builtin-source.js';
import { SystemCommandExecutor, createSystemCommands } from '../system-command.js';

import type { ICommandModule } from '../../command-api/command-module.js';
import type { ICommandHostContext, ISystemCommand } from '../../command-api/index.js';
import { createTestCommandHost } from '../../testing/command-host-double.js';
import type { IAgentJobHostContext } from '../../command-api/host-context.js';
import { createTestAgentJobHost } from '../../testing/command-host-double.js';

function createMockSession(overrides?: Record<string, unknown>, cwd = '/workspace') {
  const underlying = {
    clearHistory: vi.fn(),
    // ARCH-029: these two were MISSING while the cast was in place — the fixture claimed to be a
    // conformant ICommandSessionRuntime without them. Turning the check on surfaced it.
    getHistory: vi.fn().mockReturnValue([]),
    getFullHistory: vi.fn().mockReturnValue([]),
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

  // ARCH-029: overrides over a conformant host. The literal this replaced also carried
  // `_underlying`, a field the contract does not declare and nothing in this file reads —
  // the cast hid surplus as readily as it hid omissions.
  return createTestCommandHost({
    overrides: {
      getSession: () => underlying,
      getContextState: underlying.getContextState,
      listBackgroundTasks: underlying.listBackgroundTasks,
      cancelBackgroundTask: underlying.cancelBackgroundTask,
      closeBackgroundTask: underlying.closeBackgroundTask,
      readBackgroundTaskLog: underlying.readBackgroundTaskLog,
      listEditCheckpoints: underlying.listEditCheckpoints,
      restoreEditCheckpoint: underlying.restoreEditCheckpoint,
      rollbackEditCheckpoint: underlying.rollbackEditCheckpoint,
      // ARCH-029: the agent-job members are `IAgentJobHostContext`'s, reached through this getter —
      // the cast let the fixture hang them directly off `ICommandHostContext`, so it had the contract
      // STRUCTURE wrong and nothing could tell.
      getAgentJobCapability: () => createTestAgentJobHost(underlying),
      ...overrides,
      getCwd: () => cwd,
    },
  });
}

describe('SystemCommandExecutor', () => {
  it('keeps SDK core system commands empty so user-visible built-ins live in command modules', () => {
    const executor = new SystemCommandExecutor();
    const commands = executor.listCommands();
    expect(commands.map((c) => c.name)).toEqual([]);
    expect(commands.map((c) => c.name)).not.toContain('background');
    expect(commands.map((c) => c.name)).not.toContain('skills');
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

  it('does not expose command-module owned built-ins from SDK core', () => {
    const executor = new SystemCommandExecutor();
    const modelCommands = executor.listModelInvocableCommands();

    expect(modelCommands).toEqual([]);
    expect(executor.hasCommand('skills')).toBe(false);
    expect(executor.isModelInvocable('skills')).toBe(false);
    expect(executor.isModelInvocable('memory')).toBe(false);
    expect(executor.isModelInvocable('agent')).toBe(false);
    expect(executor.isModelInvocable('reset')).toBe(false);
    expect(executor.isModelInvocable('rewind')).toBe(false);
  });

  it('returns null for unknown command', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('nonexistent', createMockSession(), '');
    expect(result).toBeNull();
  });

  it('formats a composed command list through the SDK common API', () => {
    const session = createMockSession({
      listCommands: vi.fn().mockReturnValue([
        { name: 'help', displayName: 'Help', description: 'Show available commands' },
        {
          name: 'provider',
          displayName: 'Provider Setup',
          description: 'Manage provider profiles',
        },
      ]),
    });

    const result = formatCommandHelpMessage(session);

    expect(result).toBe(
      [
        'Available commands:',
        '  Help (/help)                     — Show available commands',
        '  Provider Setup (/provider)       — Manage provider profiles',
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

  it('resolveRequiresPermission derives from safety when field is undefined', () => {
    const executor = new SystemCommandExecutor();
    const base = { description: 'd', execute: () => ({ success: true, message: '' }) };

    expect(executor.resolveRequiresPermission({ name: 'a', safety: 'read-only', ...base })).toBe(
      false,
    );
    expect(executor.resolveRequiresPermission({ name: 'b', safety: 'write', ...base })).toBe(true);
    expect(executor.resolveRequiresPermission({ name: 'c', safety: 'network', ...base })).toBe(
      true,
    );
    expect(executor.resolveRequiresPermission({ name: 'd', ...base })).toBe(true);
  });

  it('resolveRequiresPermission respects explicit field over safety', () => {
    const executor = new SystemCommandExecutor();
    const base = { description: 'd', execute: () => ({ success: true, message: '' }) };

    expect(
      executor.resolveRequiresPermission({
        name: 'a',
        requiresPermission: false,
        safety: 'write',
        ...base,
      }),
    ).toBe(false);
    expect(
      executor.resolveRequiresPermission({
        name: 'b',
        requiresPermission: true,
        safety: 'read-only',
        ...base,
      }),
    ).toBe(true);
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

  it('TC-01: replaceCommands swaps the entire command set (prior commands removed)', () => {
    const executor = new SystemCommandExecutor([
      { name: 'old', description: 'Old command', execute: () => ({ success: true, message: '' }) },
    ]);
    expect(executor.hasCommand('old')).toBe(true);

    const cmdA: ISystemCommand = {
      name: 'a',
      description: 'Command A',
      execute: () => ({ success: true, message: '' }),
    };
    executor.replaceCommands([cmdA]);

    expect(executor.listCommands()).toEqual([cmdA]);
    expect(executor.hasCommand('old')).toBe(false);
  });

  it('projects alternate command ids by semantic role', () => {
    const executor = new SystemCommandExecutor([
      {
        name: 'activate-skill-alt',
        semanticRole: 'skillActivation',
        description: 'Activate a skill',
        execute: () => ({ success: true, message: '' }),
      },
      {
        name: 'reduce-context-alt',
        semanticRole: 'contextReduction',
        description: 'Reduce context',
        execute: () => ({ success: true, message: '' }),
      },
    ]);
    expect(executor.getSemanticRoles()).toEqual({
      skillActivation: 'activate-skill-alt',
      contextReduction: 'reduce-context-alt',
    });
  });

  it('rejects duplicate semantic roles in constructor and register without mutation', () => {
    const first: ISystemCommand = {
      name: 'first',
      semanticRole: 'skillActivation',
      description: 'First',
      execute: () => ({ success: true, message: '' }),
    };
    const duplicate: ISystemCommand = {
      name: 'duplicate',
      semanticRole: 'skillActivation',
      description: 'Duplicate',
      execute: () => ({ success: true, message: '' }),
    };
    expect(() => new SystemCommandExecutor([first, duplicate])).toThrow(
      DuplicateSystemCommandSemanticRoleError,
    );
    const executor = new SystemCommandExecutor([first]);
    expect(() => executor.register(duplicate)).toThrow(DuplicateSystemCommandSemanticRoleError);
    expect(executor.listCommands()).toEqual([first]);
    expect(executor.getSemanticRoles()).toEqual({ skillActivation: 'first' });
  });

  it('rejects duplicate semantic roles on replace atomically', () => {
    const original: ISystemCommand = {
      name: 'original',
      semanticRole: 'subagentSpawn',
      description: 'Original',
      execute: () => ({ success: true, message: '' }),
    };
    const executor = new SystemCommandExecutor([original]);
    expect(() =>
      executor.replaceCommands([
        {
          name: 'first',
          semanticRole: 'contextReduction',
          description: 'First',
          execute: () => ({ success: true, message: '' }),
        },
        {
          name: 'second',
          semanticRole: 'contextReduction',
          description: 'Second',
          execute: () => ({ success: true, message: '' }),
        },
      ]),
    ).toThrow(DuplicateSystemCommandSemanticRoleError);
    expect(executor.listCommands()).toEqual([original]);
    expect(executor.getSemanticRoles()).toEqual({ subagentSpawn: 'original' });
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
      {
        name: 'diagnose',
        kind: 'builtin-command',
        description: 'Run read-only diagnostics for the current workspace',
        userInvocable: true,
        modelInvocable: true,
        safety: 'read-only',
        requiresPermission: false,
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
