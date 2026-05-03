import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BuiltinCommandSource, createBuiltinCommandModule } from '../builtin-source.js';
import { SystemCommandExecutor, createSystemCommands } from '../system-command.js';
import type { InteractiveSession } from '../../interactive/interactive-session.js';
import type { ICommandModule } from '../../command-api/command-module.js';
import { PendingMemoryStore } from '../../memory/pending-memory-store.js';

const TMP_BASE = join(tmpdir(), `robota-system-command-${process.pid}`);

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

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
  it('lists all built-in commands', () => {
    const executor = new SystemCommandExecutor();
    const commands = executor.listCommands();
    expect(commands.length).toBeGreaterThanOrEqual(12);
    expect(commands.map((c) => c.name)).toContain('help');
    expect(commands.map((c) => c.name)).toContain('clear');
    expect(commands.map((c) => c.name)).toContain('mode');
    expect(commands.map((c) => c.name)).not.toContain('compact');
    expect(commands.map((c) => c.name)).not.toContain('context');
  });

  it('exposes only memory as a model-invocable core command', () => {
    const executor = new SystemCommandExecutor();
    const modelCommands = executor.listModelInvocableCommands();

    expect(modelCommands.map((command) => command.name)).toEqual(['/memory']);
    expect(executor.isModelInvocable('memory')).toBe(true);
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

  it('help renders the composed command list from the interactive session when available', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession({
      listCommands: vi.fn().mockReturnValue([
        { name: 'help', description: 'Show available commands' },
        { name: 'provider', description: 'Manage provider profiles' },
      ]),
    });

    const result = await executor.execute('help', session, '');

    expect(result!.message).toContain('provider');
    expect(result!.message).toContain('Manage provider profiles');
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

  it('model requests model changes through a typed command effect', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('model', createMockSession(), 'claude-sonnet-4-6');
    expect(result!.success).toBe(true);
    expect(result!.data?.modelId).toBe('claude-sonnet-4-6');
    expect(result!.effects).toEqual([
      { type: 'model-change-requested', modelId: 'claude-sonnet-4-6' },
    ]);
  });

  it('language requests language changes through a typed command effect', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('language', createMockSession(), 'ko');
    expect(result!.success).toBe(true);
    expect(result!.data?.language).toBe('ko');
    expect(result!.effects).toEqual([{ type: 'language-change-requested', language: 'ko' }]);
  });

  it('cost returns session info', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('cost', createMockSession(), '');
    expect(result!.message).toContain('test-session-id');
    expect(result!.data?.messageCount).toBe(5);
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

  it('resume requests the session picker through a typed command effect', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('resume', createMockSession(), '');
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.data?.triggerResumePicker).toBe(true);
    expect(result!.effects).toEqual([{ type: 'session-picker-requested' }]);
  });

  it('rewind list returns edit checkpoints', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession({
      listEditCheckpoints: vi.fn().mockReturnValue([
        {
          id: 'turn-0001',
          sessionId: 'test-session-id',
          sequence: 1,
          prompt: 'change files',
          createdAt: '2026-05-02T00:00:00.000Z',
          fileCount: 2,
        },
      ]),
    });

    const result = await executor.execute('rewind', session, 'list');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('turn-0001');
    expect(result!.data?.count).toBe(1);
  });

  it('rewind restore delegates code restoration to the interactive session', async () => {
    const executor = new SystemCommandExecutor();
    const restoreEditCheckpoint = vi.fn().mockResolvedValue({
      target: {
        id: 'turn-0001',
        sessionId: 'test-session-id',
        sequence: 1,
        prompt: 'change files',
        createdAt: '2026-05-02T00:00:00.000Z',
        fileCount: 1,
      },
      restoredCheckpointCount: 2,
      restoredFileCount: 3,
      removedCheckpointCount: 2,
    });
    const session = createMockSession({ restoreEditCheckpoint });

    const result = await executor.execute('rewind', session, 'restore turn-0001');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(restoreEditCheckpoint).toHaveBeenCalledWith('turn-0001');
    expect(result!.data?.restoredFileCount).toBe(3);
  });

  it('rewind rollback delegates inclusive code rollback to the interactive session', async () => {
    const executor = new SystemCommandExecutor();
    const rollbackEditCheckpoint = vi.fn().mockResolvedValue({
      target: {
        id: 'turn-0001',
        sessionId: 'test-session-id',
        sequence: 1,
        prompt: 'change files',
        createdAt: '2026-05-02T00:00:00.000Z',
        fileCount: 1,
      },
      restoredCheckpointCount: 1,
      restoredFileCount: 1,
      removedCheckpointCount: 1,
    });
    const session = createMockSession({ rollbackEditCheckpoint });

    const result = await executor.execute('rewind', session, 'rollback turn-0001');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(rollbackEditCheckpoint).toHaveBeenCalledWith('turn-0001');
    expect(result!.message).toContain('Rolled back code through turn-0001.');
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

  it('memory list reports configured memory paths', async () => {
    const cwd = makeProject();
    const executor = new SystemCommandExecutor();

    const result = await executor.execute('memory', createMockSession({}, cwd), 'list');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain(join(cwd, '.robota', 'memory', 'MEMORY.md'));
  });

  it('memory add persists index and topic entries', async () => {
    const cwd = makeProject();
    const executor = new SystemCommandExecutor();

    const result = await executor.execute(
      'memory',
      createMockSession({}, cwd),
      'add project build Use pnpm for scripts.',
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(readFileSync(join(cwd, '.robota', 'memory', 'MEMORY.md'), 'utf8')).toContain(
      '(project/build) Use pnpm for scripts.',
    );
  });

  it('memory add rejects sensitive content before writing files', async () => {
    const cwd = makeProject();
    const executor = new SystemCommandExecutor();

    const result = await executor.execute(
      'memory',
      createMockSession({}, cwd),
      'add project secrets api key is sk-test-secret',
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.message).toContain('sensitive');
    expect(existsSync(join(cwd, '.robota', 'memory', 'MEMORY.md'))).toBe(false);
  });

  it('memory command is exposed as model-invocable descriptor', () => {
    const executor = new SystemCommandExecutor();
    const descriptor = executor
      .listModelInvocableCommands()
      .find((command) => command.name === '/memory');

    expect(executor.isModelInvocable('memory')).toBe(true);
    expect(descriptor).toEqual(
      expect.objectContaining({
        name: '/memory',
        kind: 'builtin-command',
        userInvocable: true,
        modelInvocable: true,
        argumentHint:
          'list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | approve <id> | reject <id> | used',
        safety: 'write',
      }),
    );
    expect(descriptor?.description).toContain(
      'inspect project memory when stored context may help',
    );
    expect(descriptor?.description).toContain('save durable preferences, project conventions');
    expect(descriptor?.description).toContain('Do not store secrets');
  });

  it('memory pending lists queued automatic memory candidates', async () => {
    const cwd = makeProject();
    const pendingStore = new PendingMemoryStore(cwd, () => new Date('2026-05-02T00:00:00.000Z'));
    pendingStore.upsert(
      {
        id: 'mem_123',
        type: 'project',
        topic: 'build',
        text: 'Use pnpm for package scripts.',
        sourceMessageIds: ['turn-1:user'],
        confidence: 0.9,
        createdAt: '2026-05-02T00:00:00.000Z',
        reason: 'explicit-memory-cue',
      },
      'pending',
      'approval-required',
    );
    const executor = new SystemCommandExecutor();

    const result = await executor.execute('memory', createMockSession({}, cwd), 'pending');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('mem_123');
    expect(result!.message).toContain('project/build');
    expect(result!.message).toContain('Use pnpm for package scripts.');
  });

  it('memory approve saves a pending candidate and records an approval event', async () => {
    const cwd = makeProject();
    const recordMemoryEvent = vi.fn();
    const pendingStore = new PendingMemoryStore(cwd, () => new Date('2026-05-02T00:00:00.000Z'));
    pendingStore.upsert(
      {
        id: 'mem_123',
        type: 'project',
        topic: 'build',
        text: 'Use pnpm for package scripts.',
        sourceMessageIds: ['turn-1:user'],
        confidence: 0.9,
        createdAt: '2026-05-02T00:00:00.000Z',
        reason: 'explicit-memory-cue',
      },
      'pending',
      'approval-required',
    );
    const executor = new SystemCommandExecutor();

    const result = await executor.execute(
      'memory',
      createMockSession({ recordMemoryEvent }, cwd),
      'approve mem_123',
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('Saved memory candidate mem_123');
    expect(readFileSync(join(cwd, '.robota', 'memory', 'MEMORY.md'), 'utf8')).toContain(
      '(project/build) Use pnpm for package scripts.',
    );
    expect(new PendingMemoryStore(cwd).get('mem_123')?.status).toBe('saved');
    expect(recordMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'memory_candidate_approved', candidateId: 'mem_123' }),
    );
  });

  it('memory reject marks a pending candidate rejected', async () => {
    const cwd = makeProject();
    const recordMemoryEvent = vi.fn();
    const pendingStore = new PendingMemoryStore(cwd, () => new Date('2026-05-02T00:00:00.000Z'));
    pendingStore.upsert(
      {
        id: 'mem_123',
        type: 'project',
        topic: 'build',
        text: 'Use pnpm for package scripts.',
        sourceMessageIds: ['turn-1:user'],
        confidence: 0.9,
        createdAt: '2026-05-02T00:00:00.000Z',
        reason: 'explicit-memory-cue',
      },
      'pending',
      'approval-required',
    );
    const executor = new SystemCommandExecutor();

    const result = await executor.execute(
      'memory',
      createMockSession({ recordMemoryEvent }, cwd),
      'reject mem_123',
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('Rejected memory candidate mem_123');
    expect(new PendingMemoryStore(cwd).get('mem_123')?.status).toBe('rejected');
    expect(recordMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'memory_candidate_rejected', candidateId: 'mem_123' }),
    );
  });

  it('memory used reports references from the current turn', async () => {
    const cwd = makeProject();
    const executor = new SystemCommandExecutor();
    const session = createMockSession(
      {
        getUsedMemoryReferences: vi.fn().mockReturnValue([
          {
            topic: 'build',
            path: join(cwd, '.robota', 'memory', 'topics', 'build.md'),
            score: 5,
            truncated: false,
          },
        ]),
      },
      cwd,
    );

    const result = await executor.execute('memory', session, 'used');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('build');
    expect(result!.message).toContain(join(cwd, '.robota', 'memory', 'topics', 'build.md'));
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
      expect.objectContaining({
        name: '/memory',
        kind: 'builtin-command',
        userInvocable: true,
        modelInvocable: true,
        argumentHint:
          'list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | approve <id> | reject <id> | used',
        safety: 'write',
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
