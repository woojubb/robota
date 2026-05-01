import { describe, it, expect, vi } from 'vitest';
import { SystemCommandExecutor, createSystemCommands } from '../system-command.js';
import type { InteractiveSession } from '../../interactive/interactive-session.js';
import type { ICommandModule } from '../command-module.js';

function createMockSession(overrides?: Record<string, unknown>) {
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
    sendAgentJob: underlying.sendAgentJob,
    cancelAgentJob: underlying.cancelAgentJob,
    closeAgentJob: underlying.closeAgentJob,
    _underlying: underlying,
  } as unknown as InteractiveSession;
}

describe('SystemCommandExecutor', () => {
  it('lists all built-in commands', () => {
    const executor = new SystemCommandExecutor();
    const commands = executor.listCommands();
    expect(commands.length).toBeGreaterThanOrEqual(12);
    expect(commands.map((c) => c.name)).toContain('help');
    expect(commands.map((c) => c.name)).toContain('clear');
    expect(commands.map((c) => c.name)).toContain('mode');
  });

  it('does not expose model-invocable commands from the core command set', () => {
    const executor = new SystemCommandExecutor();
    const modelCommands = executor.listModelInvocableCommands();

    expect(modelCommands).toEqual([]);
    expect(executor.isModelInvocable('agent')).toBe(false);
    expect(executor.isModelInvocable('reset')).toBe(false);
  });

  it('returns null for unknown command', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('nonexistent', createMockSession(), '');
    expect(result).toBeNull();
  });

  it('help returns command list', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('help', createMockSession(), '');
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('Available commands');
  });

  it('clear calls session.clearHistory', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession();
    const result = await executor.execute('clear', session, '');
    expect(result!.success).toBe(true);
    expect(
      (session as unknown as { _underlying: { clearHistory: ReturnType<typeof vi.fn> } })
        ._underlying.clearHistory,
    ).toHaveBeenCalled();
  });

  it('mode shows current mode without args', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('mode', createMockSession(), '');
    expect(result!.message).toContain('default');
    expect(result!.data?.mode).toBe('default');
  });

  it('mode sets valid mode', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession();
    const result = await executor.execute('mode', session, 'plan');
    expect(result!.success).toBe(true);
    expect(result!.data?.mode).toBe('plan');
  });

  it('mode rejects invalid mode', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('mode', createMockSession(), 'invalid');
    expect(result!.success).toBe(false);
  });

  it('model returns modelId in data', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('model', createMockSession(), 'claude-sonnet-4-6');
    expect(result!.success).toBe(true);
    expect(result!.data?.modelId).toBe('claude-sonnet-4-6');
  });

  it('language returns language in data', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('language', createMockSession(), 'ko');
    expect(result!.success).toBe(true);
    expect(result!.data?.language).toBe('ko');
  });

  it('cost returns session info', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('cost', createMockSession(), '');
    expect(result!.message).toContain('test-session-id');
    expect(result!.data?.messageCount).toBe(5);
  });

  it('context returns token usage', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('context', createMockSession(), '');
    expect(result!.message).toContain('5,000');
    expect(result!.data?.usedTokens).toBe(5000);
  });

  it('compact calls session.compact', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession();
    const result = await executor.execute('compact', session, 'focus on tests');
    expect(result!.success).toBe(true);
    expect(
      (session as unknown as { _underlying: { compact: ReturnType<typeof vi.fn> } })._underlying
        .compact,
    ).toHaveBeenCalledWith('focus on tests');
  });

  it('resume returns triggerResumePicker in data', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('resume', createMockSession(), '');
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.data?.triggerResumePicker).toBe(true);
  });

  it('background list returns task summaries', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession({
      listBackgroundTasks: vi.fn().mockReturnValue([
        {
          id: 'agent_1',
          kind: 'agent',
          label: 'Explore',
          status: 'running',
          mode: 'background',
          parentSessionId: 'session_parent',
          depth: 1,
          cwd: '/workspace',
          updatedAt: '2026-04-30T00:00:00.000Z',
          lastActivityAt: '2026-04-30T00:00:01.000Z',
          unread: false,
          promptPreview: 'Find files',
        },
      ]),
    });

    const result = await executor.execute('background', session, 'list');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain(
      'agent_1 [running lastActivityAt=2026-04-30T00:00:01.000Z] agent:Explore',
    );
    expect(result!.data?.count).toBe(1);
  });

  it('background cancel targets one task', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession();

    const result = await executor.execute('background', session, 'cancel agent_1 no longer needed');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(
      (session as unknown as { _underlying: { cancelBackgroundTask: ReturnType<typeof vi.fn> } })
        ._underlying.cancelBackgroundTask,
    ).toHaveBeenCalledWith('agent_1', 'no longer needed');
  });

  it('background read returns a log page', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession({
      readBackgroundTaskLog: vi.fn().mockResolvedValue({
        taskId: 'process_1',
        nextCursor: { offset: 200 },
        lines: ['[stdout] hello'],
      }),
    });

    const result = await executor.execute('background', session, 'read process_1 0');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('[stdout] hello');
    expect(result!.message).toContain('Next offset: 200');
  });

  it('rename returns name in data', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('rename', createMockSession(), 'my-session');
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.data?.name).toBe('my-session');
  });

  it('rename fails without name argument', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('rename', createMockSession(), '');
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
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
