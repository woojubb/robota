import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  InteractiveSession,
  SystemCommandExecutor,
  createCommandPendingMemoryStore,
} from '@robota-sdk/agent-sdk';
import { MemoryCommandSource, createMemoryCommandModule, executeMemoryCommand } from '../index.js';

const TMP_BASE = join(tmpdir(), `robota-command-memory-${process.pid}`);

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createMockRuntimeSession() {
  return {
    run: vi.fn().mockResolvedValue('mock response'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    compact: vi.fn().mockResolvedValue(undefined),
    injectMessage: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({
      usedTokens: 5000,
      maxTokens: 200000,
      usedPercentage: 2.5,
      remainingPercentage: 97.5,
    }),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getMessageCount: vi.fn().mockReturnValue(5),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    getAutoCompactThreshold: vi.fn().mockReturnValue(0.835),
    setAutoCompactThreshold: vi.fn(),
    getSystemMessage: vi.fn().mockReturnValue('mock system prompt'),
    getToolSchemas: vi.fn().mockReturnValue([]),
  };
}

function createInteractiveSession(cwd = makeProject()): InteractiveSession {
  return new InteractiveSession({
    cwd,
    session: createMockRuntimeSession() as never,
    commandModules: [createMemoryCommandModule()],
  });
}

function seedPendingMemory(cwd: string): void {
  const pendingStore = createCommandPendingMemoryStore(
    cwd,
    () => new Date('2026-05-02T00:00:00.000Z'),
  );
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
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('createMemoryCommandModule', () => {
  it('contributes write-safe model-invocable memory metadata and executable command', () => {
    const module = createMemoryCommandModule();
    const commands = module.commandSources?.flatMap((source) => source.getCommands()) ?? [];

    expect(module.name).toBe('agent-command-memory');
    expect(commands.map((command) => command.name)).toEqual(['memory']);
    expect(commands[0]?.source).toBe('memory');
    expect(commands[0]?.modelInvocable).toBe(true);
    expect(commands[0]?.safety).toBe('write');
    expect(commands[0]?.subcommands?.map((command) => command.name)).toEqual([
      'list',
      'show',
      'add',
      'pending',
      'approve',
      'reject',
      'used',
    ]);
    expect(module.systemCommands?.map((command) => command.name)).toEqual(['memory']);
    expect(module.systemCommands?.[0]?.userInvocable).toBe(true);
  });

  it('provides a stable command source', () => {
    const source = new MemoryCommandSource();

    expect(source.name).toBe('memory');
    expect(source.getCommands()).toHaveLength(1);
  });

  it('exposes the command as a model-invocable descriptor', () => {
    const executor = new SystemCommandExecutor([
      ...(createMemoryCommandModule().systemCommands ?? []),
    ]);
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
  });
});

describe('executeMemoryCommand', () => {
  it('lists configured memory paths', async () => {
    const cwd = makeProject();
    const session = createInteractiveSession(cwd);

    const result = await session.executeCommand('memory', 'list');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain(join(cwd, '.robota', 'memory', 'MEMORY.md'));
  });

  it('persists index and topic entries through slash invocation', async () => {
    const cwd = makeProject();
    const session = createInteractiveSession(cwd);

    const result = await session.executeCommand(
      'memory',
      'add project build Use pnpm for scripts.',
    );

    expect(result?.success).toBe(true);
    expect(readFileSync(join(cwd, '.robota', 'memory', 'MEMORY.md'), 'utf8')).toContain(
      '(project/build) Use pnpm for scripts.',
    );
  });

  it('uses the same handler for model invocation', async () => {
    const cwd = makeProject();
    const session = createInteractiveSession(cwd);

    const result = await session.executeModelCommand(
      'memory',
      'add project build Use pnpm for package scripts.',
    );

    expect(result?.success).toBe(true);
    expect(readFileSync(join(cwd, '.robota', 'memory', 'MEMORY.md'), 'utf8')).toContain(
      '(project/build) Use pnpm for package scripts.',
    );
  });

  it('rejects sensitive content before writing files', async () => {
    const cwd = makeProject();
    const session = createInteractiveSession(cwd);

    const result = await session.executeCommand(
      'memory',
      'add project secrets api key is sk-test-secret',
    );

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('sensitive');
    expect(existsSync(join(cwd, '.robota', 'memory', 'MEMORY.md'))).toBe(false);
  });

  it('lists queued automatic memory candidates', async () => {
    const cwd = makeProject();
    seedPendingMemory(cwd);
    const session = createInteractiveSession(cwd);

    const result = await session.executeCommand('memory', 'pending');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('mem_123');
    expect(result?.message).toContain('project/build');
    expect(result?.message).toContain('Use pnpm for package scripts.');
  });

  it('approves and saves a pending candidate while recording audit events', async () => {
    const cwd = makeProject();
    seedPendingMemory(cwd);
    const session = createInteractiveSession(cwd);
    const recordMemoryEvent = vi.spyOn(session, 'recordMemoryEvent');

    const result = await session.executeCommand('memory', 'approve mem_123');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Saved memory candidate mem_123');
    expect(readFileSync(join(cwd, '.robota', 'memory', 'MEMORY.md'), 'utf8')).toContain(
      '(project/build) Use pnpm for package scripts.',
    );
    expect(createCommandPendingMemoryStore(cwd).get('mem_123')?.status).toBe('saved');
    expect(recordMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'memory_candidate_approved', candidateId: 'mem_123' }),
    );
    expect(recordMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'memory_candidate_saved', candidateId: 'mem_123' }),
    );
  });

  it('rejects a pending candidate while recording an audit event', async () => {
    const cwd = makeProject();
    seedPendingMemory(cwd);
    const session = createInteractiveSession(cwd);
    const recordMemoryEvent = vi.spyOn(session, 'recordMemoryEvent');

    const result = await session.executeCommand('memory', 'reject mem_123');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Rejected memory candidate mem_123');
    expect(createCommandPendingMemoryStore(cwd).get('mem_123')?.status).toBe('rejected');
    expect(recordMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'memory_candidate_rejected', candidateId: 'mem_123' }),
    );
  });

  it('reports references from the current turn', async () => {
    const cwd = makeProject();
    const session = createInteractiveSession(cwd);
    vi.spyOn(session, 'getUsedMemoryReferences').mockReturnValue([
      {
        topic: 'build',
        path: join(cwd, '.robota', 'memory', 'topics', 'build.md'),
        score: 5,
        truncated: false,
      },
    ]);

    const result = await session.executeCommand('memory', 'used');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('build');
    expect(result?.message).toContain(join(cwd, '.robota', 'memory', 'topics', 'build.md'));
  });

  it('returns usage for invalid arguments without mutating state', async () => {
    const cwd = makeProject();
    const session = createInteractiveSession(cwd);

    const result = await executeMemoryCommand(session, 'add project missing-text');
    const unknownResult = await executeMemoryCommand(session, 'unknown');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage: memory');
    expect(unknownResult.success).toBe(false);
    expect(existsSync(join(cwd, '.robota', 'memory', 'MEMORY.md'))).toBe(false);
  });
});
