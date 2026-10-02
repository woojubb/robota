import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  InteractiveSession,
  SystemCommandExecutor,
  WorkspaceTrustService,
  createWorkspaceMemoryStore,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import { MemoryCommandSource, createMemoryCommandModule, executeMemoryCommand } from '../index.js';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import type {
  IMemoryStore,
  IRemoteCommandPolicy,
  IWorkspaceIdentity,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
} from '@robota-sdk/agent-framework';

// SEC-003 (js/insecure-temporary-file): `mkdtempSync` yields a 0700 directory with an unpredictable
// name, so no other user can pre-create or read the paths this suite writes under it.
const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'agent-test-command-memory-')));
const memoryStores = new Map<string, Promise<IMemoryStore>>();

class TrustedStore implements IWorkspaceTrustStore {
  inspect(): Promise<IWorkspaceTrustStoreSnapshot> {
    return Promise.resolve({ state: 'trusted', generation: 1 });
  }

  grant(): Promise<IWorkspaceTrustStoreSnapshot> {
    return this.inspect();
  }

  revoke(): Promise<IWorkspaceTrustStoreSnapshot> {
    return Promise.resolve({ state: 'revoked', generation: 2 });
  }
}

function createMemoryStore(cwd: string): Promise<IMemoryStore> {
  const existing = memoryStores.get(cwd);
  if (existing !== undefined) return existing;
  const created = (async () => {
    const root = realpathSync(cwd);
    const identity: IWorkspaceIdentity = {
      repositoryKey: `memory-test:${root}`,
      displayPath: root,
      worktreeRoot: root,
    };
    const service = new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store: new TrustedStore(),
      projectStateDirectories: {
        sessions: join('.fixture-state', 'sessions'),
        'session-logs': join('.fixture-state', 'logs'),
        memory: join('.fixture-state', 'memory'),
        checkpoints: join('.fixture-state', 'checkpoints'),
      },
    });
    const access = await service.inspect(root);
    if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
    return createWorkspaceMemoryStore(
      getWorkspaceProjectStateStorage(access.authority, 'memory'),
      () => new Date('2026-05-02T00:00:00.000Z'),
    );
  })();
  memoryStores.set(cwd, created);
  return created;
}

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

async function createInteractiveSession(
  cwd = makeProject(),
  permissionMode: 'default' | 'plan' = 'default',
  remoteCommandPolicy?: IRemoteCommandPolicy,
): Promise<InteractiveSession> {
  const runtime = createMockRuntimeSession();
  runtime.getPermissionMode.mockReturnValue(permissionMode);
  return new InteractiveSession({
    cwd,
    session: runtime as never,
    memoryStore: await createMemoryStore(cwd),
    commandModules: [createMemoryCommandModule()],
    ...(remoteCommandPolicy ? { remoteCommandPolicy } : {}),
  });
}

async function seedPendingMemory(cwd: string): Promise<void> {
  const store = await createMemoryStore(cwd);
  await store.upsertPending(
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
  memoryStores.clear();
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
      'correct',
      'forget',
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
      .find((command) => command.name === 'memory');

    expect(executor.isModelInvocable('memory')).toBe(true);
    expect(descriptor).toEqual(
      expect.objectContaining({
        name: 'memory',
        kind: 'builtin-command',
        userInvocable: true,
        modelInvocable: true,
        // The model is offered only what it may run: `approve`/`reject` are the user's review.
        argumentHint:
          '[list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | used]',
        safety: 'write',
      }),
    );
    expect(descriptor?.description).toContain('look up stored conventions');
    expect(descriptor?.description).toContain('suggest `/memory approve <id>`');
  });

  it('refuses a model-issued `memory approve` before the command runs, and allows the user', async () => {
    const executor = new SystemCommandExecutor([
      ...(createMemoryCommandModule().systemCommands ?? []),
    ]);
    const command = executor.getCommand('memory');
    const execute = vi.fn();
    const host = createTestCommandHost();
    const spied = { ...command!, execute };
    const gated = new SystemCommandExecutor([spied]);

    for (const args of [
      'approve cand-1',
      'reject cand-1',
      'APPROVE cand-1',
      'correct project build Use pnpm.',
      'forget build',
      'FORGET build',
    ]) {
      const result = await gated.executeModelInvocable('memory', host, args);
      expect(result?.success).toBe(false);
      expect(result?.message).toContain('only the user can');
    }
    expect(execute).not.toHaveBeenCalled();

    await gated.executeModelInvocable('memory', host, 'list');
    await gated.execute('memory', host, 'approve cand-1');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe('executeMemoryCommand', () => {
  it.runIf(process.platform === 'linux').each(['user', 'remote'] as const)(
    'lets an authenticated %s command replace and forget a topic through the shared slash handler',
    async (source) => {
      const cwd = makeProject();
      const session = await createInteractiveSession(cwd);
      await session.executeCommand('memory', 'add project build Use npm for builds.');
      const corrected = await session.executeCommand(
        'memory',
        'correct project build Use pnpm for builds.',
        source,
      );
      expect(corrected?.success).toBe(true);
      expect((await session.readProjectMemory()).kind).toBe('memory');
      expect((await session.executeCommand('memory', 'show build'))?.message).toContain('Use pnpm');
      expect((await session.executeCommand('memory', 'show build'))?.message).not.toContain(
        'Use npm',
      );
      const forgotten = await session.executeCommand('memory', 'forget build', source);
      expect(forgotten?.success).toBe(true);
      expect((await session.executeCommand('memory', 'show'))?.message).not.toContain('Use pnpm');
      expect(forgotten?.message).toContain('transcripts');
    },
  );

  it.runIf(process.platform === 'linux')(
    'keeps attached memory curation subject to the host remote command policy',
    async () => {
      const cwd = makeProject();
      const session = await createInteractiveSession(cwd, 'default', { isAllowed: () => false });
      const store = session.getMemoryStore();
      await store.append({ type: 'project', topic: 'build', text: 'Use pnpm for builds.' });
      for (const args of ['correct project build Use npm.', 'forget build']) {
        const result = await session.executeCommand('memory', args, 'remote');
        expect(result?.success).toBe(false);
        expect(result?.message).toContain('configured remote-command policy');
        expect(await store.readTopic('build')).toContain('Use pnpm');
      }
    },
  );

  it.runIf(process.platform === 'linux')(
    'refuses direct model calls to destructive memory operations',
    async () => {
      const cwd = makeProject();
      const session = await createInteractiveSession(cwd);
      await session.executeCommand('memory', 'add project build Use pnpm for builds.');
      const corrected = await executeMemoryCommand(
        {
          ...createTestCommandHost(),
          getCwd: () => cwd,
          getMemoryStore: () => session.getMemoryStore(),
          getCommandInvocationSource: () => 'model',
        },
        'correct project build Use npm for builds.',
      );
      expect(corrected.success).toBe(false);
      expect(corrected.message).toContain('only the user');
      expect(await session.getMemoryStore().readTopic('build')).toContain('Use pnpm');
    },
  );

  it('lists configured memory paths', async () => {
    const cwd = makeProject();
    const session = await createInteractiveSession(cwd);

    const result = await session.executeCommand('memory', 'list');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain(join('.fixture-state', 'memory', 'MEMORY.md'));
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'persists index and topic entries through slash invocation',
    async () => {
      const cwd = makeProject();
      const session = await createInteractiveSession(cwd);

      const result = await session.executeCommand(
        'memory',
        'add project build Use pnpm for scripts.',
      );

      expect(result?.success).toBe(true);
      expect(readFileSync(join(cwd, '.fixture-state', 'memory', 'MEMORY.md'), 'utf8')).toContain(
        '(project/build) Use pnpm for scripts.',
      );
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')('uses the same handler for model invocation', async () => {
    const cwd = makeProject();
    const session = await createInteractiveSession(cwd);

    const result = await session.executeModelCommand(
      'memory',
      'add project build Use pnpm for package scripts.',
    );

    expect(result?.success).toBe(true);
    expect(readFileSync(join(cwd, '.fixture-state', 'memory', 'MEMORY.md'), 'utf8')).toContain(
      '(project/build) Use pnpm for package scripts.',
    );
  });

  it('rejects sensitive content before writing files', async () => {
    const cwd = makeProject();
    const session = await createInteractiveSession(cwd);

    const result = await session.executeCommand(
      'memory',
      'add project secrets api key is sk-test-secret',
    );

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('sensitive');
    expect(existsSync(join(cwd, '.fixture-state', 'memory', 'MEMORY.md'))).toBe(false);
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')('lists queued automatic memory candidates', async () => {
    const cwd = makeProject();
    await seedPendingMemory(cwd);
    const session = await createInteractiveSession(cwd);

    const result = await session.executeCommand('memory', 'pending');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('mem_123');
    expect(result?.message).toContain('project/build');
    expect(result?.message).toContain('Use pnpm for package scripts.');
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'approves and saves a pending candidate while recording audit events',
    async () => {
      const cwd = makeProject();
      await seedPendingMemory(cwd);
      const session = await createInteractiveSession(cwd);
      const recordMemoryEvent = vi.spyOn(session, 'recordMemoryEvent');

      const result = await session.executeCommand('memory', 'approve mem_123');

      expect(result?.success).toBe(true);
      expect(result?.message).toContain('Saved memory candidate mem_123');
      expect(readFileSync(join(cwd, '.fixture-state', 'memory', 'MEMORY.md'), 'utf8')).toContain(
        '(project/build) Use pnpm for package scripts.',
      );
      expect((await (await createMemoryStore(cwd)).getPending('mem_123'))?.status).toBe('saved');
      expect(recordMemoryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'memory_candidate_approved', candidateId: 'mem_123' }),
      );
      expect(recordMemoryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'memory_candidate_saved', candidateId: 'mem_123' }),
      );
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'rejects a pending candidate while recording an audit event',
    async () => {
      const cwd = makeProject();
      await seedPendingMemory(cwd);
      const session = await createInteractiveSession(cwd);
      const recordMemoryEvent = vi.spyOn(session, 'recordMemoryEvent');

      const result = await session.executeCommand('memory', 'reject mem_123');

      expect(result?.success).toBe(true);
      expect(result?.message).toContain('Rejected memory candidate mem_123');
      expect((await (await createMemoryStore(cwd)).getPending('mem_123'))?.status).toBe('rejected');
      expect(recordMemoryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'memory_candidate_rejected', candidateId: 'mem_123' }),
      );
    },
  );

  it('reports references from the current turn', async () => {
    const cwd = makeProject();
    const session = await createInteractiveSession(cwd);
    vi.spyOn(session, 'getUsedMemoryReferences').mockReturnValue([
      {
        topic: 'build',
        path: join(cwd, '.fixture-state', 'memory', 'topics', 'build.md'),
        score: 5,
        truncated: false,
      },
    ]);

    const result = await session.executeCommand('memory', 'used');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('build');
    expect(result?.message).toContain(join(cwd, '.fixture-state', 'memory', 'topics', 'build.md'));
  });

  it('returns usage for invalid arguments without mutating state', async () => {
    const cwd = makeProject();
    const session = await createInteractiveSession(cwd);

    const result = await executeMemoryCommand(session, 'add project missing-text');
    const unknownResult = await executeMemoryCommand(session, 'unknown');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage: memory');
    expect(unknownResult.success).toBe(false);
    expect(existsSync(join(cwd, '.fixture-state', 'memory', 'MEMORY.md'))).toBe(false);
  });

  describe('in plan mode', () => {
    it('refuses a memory the model asks to save, and writes nothing', async () => {
      const cwd = makeProject();
      const session = await createInteractiveSession(cwd, 'plan');

      const result = await session.executeModelCommand('memory', 'add project build Use pnpm.');

      expect(result?.success).toBe(false);
      expect(result?.message).toContain('Plan mode saves no memory');
      expect(existsSync(join(cwd, '.fixture-state', 'memory', 'MEMORY.md'))).toBe(false);
    });

    // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'still saves a memory the user adds by hand',
      async () => {
        const cwd = makeProject();
        const session = await createInteractiveSession(cwd, 'plan');

        const result = await session.executeCommand('memory', 'add project build Use pnpm.');

        expect(result?.success).toBe(true);
        expect(existsSync(join(cwd, '.fixture-state', 'memory', 'MEMORY.md'))).toBe(true);
      },
    );

    it('lets the model read memory', async () => {
      const session = await createInteractiveSession(makeProject(), 'plan');
      const result = await session.executeModelCommand('memory', 'list');
      expect(result?.success).toBe(true);
    });
  });
});
