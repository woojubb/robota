import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import type {
  IManagedRunProvider,
  TExecutionJournalRecord,
  TManagedToolBatch,
} from '@robota-sdk/agent-core';
import type { IExecutionJournalStore } from '@robota-sdk/agent-session';
import { NodeExecutionJournalStore } from '@robota-sdk/agent-session/node';

import { InteractiveSession } from '../interactive-session.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

const testHost = createTestFrameworkHost();

class TestInteractive extends InteractiveSession {
  owner() {
    return this.getSessionOrThrow();
  }
  tracker() {
    return this.histTracker;
  }
}

let root: string;
const opened: TestInteractive[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'framework-managed-journal-')));
});
afterEach(async () => {
  await Promise.all(opened.splice(0).map((session) => session.shutdown()));
  rmSync(root, { recursive: true, force: true });
});

function frame(): TManagedToolBatch {
  return {
    id: 'frame-1',
    role: 'assistant',
    content: '',
    state: 'complete',
    timestamp: new Date(),
    toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'Act', arguments: '{}' } }],
  } as TManagedToolBatch;
}

function managedProvider(options: { frames?: boolean } = {}) {
  const effect = vi.fn(async () => 'effect');
  const provider: IManagedRunProvider = {
    kind: 'managed-run',
    name: 'managed-fixture',
    version: 'fixture',
    validateConfig: () => true,
    run: vi.fn(async (_input, host) => {
      if (options.frames) await host.execute(frame());
      return {
        id: 'final',
        role: 'assistant' as const,
        content: 'managed answer',
        timestamp: new Date(),
        state: 'complete' as const,
      };
    }),
  };
  const tool = new FunctionTool(
    { name: 'Act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
    effect,
  );
  return { provider, effect, tool };
}

function interactive(
  provider: IManagedRunProvider | ReturnType<typeof createScriptedProvider>['provider'],
  extra: Record<string, unknown> = {},
) {
  const session = new TestInteractive({
    host: testHost,
    cwd: root,
    provider: provider as never,
    bare: true,
    defaultTools: [],
    permissionMode: 'bypassPermissions',
    ...extra,
  });
  opened.push(session);
  return session;
}

function journals(): NodeExecutionJournalStore {
  return new NodeExecutionJournalStore(join(root, 'sessions'), { sealing: 'plain' });
}

describe('InteractiveSession managed turns', () => {
  it('runs a managed turn through the durable journal and seals the execution', async () => {
    const managed = managedProvider({ frames: true });
    const store = journals();
    const session = interactive(managed.provider, {
      executionJournals: store,
      additionalTools: [managed.tool],
    });
    await session.submit('go');
    expect(managed.provider.run).toHaveBeenCalledOnce();
    expect(managed.effect).toHaveBeenCalledOnce();
    const id = session.owner().getSessionId();
    const directory = join(root, 'sessions', 'journals', id);
    const names = readdirSync(directory);
    expect(names.filter((name) => name.endsWith('.jsonl'))).toHaveLength(1);
    expect(names.filter((name) => name.endsWith('.sealed'))).toHaveLength(1);
    expect(await store.forSession(id).unresolved()).toEqual([]);
  });

  it('refuses a managed turn when the host supplied no journal', async () => {
    const managed = managedProvider();
    const session = interactive(managed.provider);
    const failures: Error[] = [];
    session.on('error', (error: Error) => failures.push(error));
    await session.submit('go');
    expect(managed.provider.run).not.toHaveBeenCalled();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(/managed/i);
  });

  it('leaves a model-step turn on its own path and never writes a journal', async () => {
    const scripted = createScriptedProvider([{ text: 'plain answer' }]);
    const store = journals();
    const append = vi.fn();
    const spied: IExecutionJournalStore = {
      forSession: (sessionId) => {
        const journal = store.forSession(sessionId);
        return {
          ...journal,
          unresolved: () => journal.unresolved(),
          seal: (...args) => journal.seal(...args),
          sealOf: (...args) => journal.sealOf(...args),
          read: (executionId) => journal.read(executionId),
          append: async (record: TExecutionJournalRecord) => {
            append(record);
            return journal.append(record);
          },
        };
      },
    };
    const session = interactive(scripted.provider, { executionJournals: spied });
    await session.submit('hi');
    expect(scripted.requests).toHaveLength(1);
    expect(append).not.toHaveBeenCalled();
    expect(readdirSyncOrEmpty(join(root, 'sessions', 'journals'))).toEqual([]);
  });

  it('refuses input behind a crashed execution, and abandoning it makes the session usable', async () => {
    const managed = managedProvider();
    const store = journals();
    // The crashed process left an unsealed execution under this session's journal.
    const crashed: IExecutionJournalStore = {
      forSession: () => store.forSession('crashed-session'),
    };
    await store.forSession('crashed-session').append({
      kind: 'model-request',
      recordId: 'r1',
      executionId: 'exec_crashed',
      callId: 'c1',
      providerId: 'p',
      modelId: 'm',
      messages: [],
      options: {},
    } as TExecutionJournalRecord);

    const session = interactive(managed.provider, { executionJournals: crashed });
    await expect(session.submit('again')).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(managed.provider.run).not.toHaveBeenCalled();
    // The hold, not only the turn's own check, stands behind forks and moves.
    await expect(session.forkSession()).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });

    const abandoned = await session.abandonUnresolvedExecutions();
    expect(abandoned.executionIds).toEqual(['exec_crashed']);
    expect(abandoned.message).toMatch(/may have changed files or reached outside/);
    expect(await store.forSession('crashed-session').sealOf('exec_crashed')).toMatchObject({
      reason: 'abandoned',
    });

    await session.submit('fresh');
    expect(managed.provider.run).toHaveBeenCalledOnce();
  });

  it('abandoning with nothing pending, or without a journal, changes nothing', async () => {
    const withJournal = interactive(managedProvider().provider, { executionJournals: journals() });
    expect(await withJournal.abandonUnresolvedExecutions()).toEqual({
      executionIds: [],
      message: 'No managed execution is waiting to be abandoned.',
    });
    const without = interactive(managedProvider().provider);
    expect((await without.abandonUnresolvedExecutions()).executionIds).toEqual([]);
  });
});

describe('InteractiveSession code rewind and the managed continuation', () => {
  it.each([
    ['restoreEditCheckpoint', (s: TestInteractive) => s.restoreEditCheckpoint('c')],
    ['rollbackEditCheckpoint', (s: TestInteractive) => s.rollbackEditCheckpoint('c')],
    ['forkCheckpointBranch', (s: TestInteractive) => s.forkCheckpointBranch('c')],
  ] as const)('%s ends the continuation, whether or not the rewind finished', async (name, run) => {
    for (const outcome of ['finishes', 'fails'] as const) {
      const session = interactive(managedProvider().provider, { executionJournals: journals() });
      await session.abandonUnresolvedExecutions();
      const invalidate = vi.spyOn(session.owner(), 'invalidateManagedContinuation');
      const tracker = session.tracker() as unknown as Record<string, unknown>;
      tracker[name] =
        outcome === 'finishes'
          ? vi.fn(async () => ({}))
          : vi.fn(async () => {
              throw new Error('rewind failed');
            });
      if (outcome === 'fails') await expect(run(session)).rejects.toThrow('rewind failed');
      else await run(session);
      expect(invalidate).toHaveBeenCalledOnce();
    }
  });

  it('switchCheckpointBranch ends the continuation', async () => {
    const session = interactive(managedProvider().provider, { executionJournals: journals() });
    await session.abandonUnresolvedExecutions();
    const invalidate = vi.spyOn(session.owner(), 'invalidateManagedContinuation');
    (session.tracker() as unknown as Record<string, unknown>)['switchCheckpointBranch'] = vi.fn();
    session.switchCheckpointBranch('c');
    expect(invalidate).toHaveBeenCalledOnce();
  });
});

function readdirSyncOrEmpty(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
