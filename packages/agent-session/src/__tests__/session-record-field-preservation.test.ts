import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AbstractAIProvider } from '@robota-sdk/agent-core';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import { NodeSessionStore, Session } from '../index.js';

import type {
  IChatOptions,
  ISpinner,
  ITerminalOutput,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';
import { loadedOrMissing } from './store-load-helpers.js';

const SESSION_ID = 'arch-015-record-preservation';
const CREATED_AT = '2026-08-01T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-08-01T01:00:00.000Z';

class PreservationProvider extends AbstractAIProvider {
  override readonly name = 'arch-015-offline';
  override readonly version = '1.0.0';

  override async chat(
    messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    const content = messages.at(-1)?.content;
    return {
      id: 'msg-arch-015',
      role: 'assistant',
      content: `arch-015:${typeof content === 'string' ? content : ''}`,
      state: 'complete',
      timestamp: new Date(),
    };
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    yield await this.chat(messages, options);
  }
}

const silentTerminal: ITerminalOutput = {
  write(): void {},
  writeLine(): void {},
  writeMarkdown(): void {},
  writeError(): void {},
  async prompt(): Promise<string> {
    return '';
  },
  async select(): Promise<number> {
    return 0;
  },
  spinner(): ISpinner {
    return { stop(): void {}, update(): void {} };
  },
};

function createExistingRecord(): IInteractiveSessionRecord {
  const backgroundTask = {
    id: 'task-1',
    kind: 'process' as const,
    label: 'preserve task',
    status: 'completed' as const,
    mode: 'background' as const,
    parentSessionId: SESSION_ID,
    depth: 0,
    cwd: '/stale/task',
    updatedAt: CREATED_AT,
    unread: false,
  };
  const backgroundGroup = {
    id: 'group-1',
    parentSessionId: SESSION_ID,
    waitPolicy: 'wait_all' as const,
    taskIds: [backgroundTask.id],
    status: 'completed' as const,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    results: [],
  };

  return {
    id: SESSION_ID,
    name: 'preserved session name',
    cwd: '/stale/session',
    createdAt: CREATED_AT,
    updatedAt: STALE_UPDATED_AT,
    messages: [
      {
        id: 'm-stale',
        role: 'user',
        content: 'stale message',
        timestamp: new Date('2026-08-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
    history: [
      {
        id: 'stale-history',
        timestamp: new Date(CREATED_AT),
        category: 'event',
        type: 'stale',
      },
    ],
    systemPrompt: 'stale system prompt',
    toolSchemas: [
      {
        name: 'stale_tool',
        description: 'must be overwritten',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    ],
    backgroundTasks: [backgroundTask],
    backgroundTaskEvents: [{ type: 'background_task_completed', task: backgroundTask }],
    backgroundJobGroups: [backgroundGroup],
    backgroundJobGroupEvents: [{ type: 'background_job_group_completed', group: backgroundGroup }],
    skillActivationEvents: [
      {
        type: 'skill-activation',
        skillName: 'preserved-skill',
        source: 'skill',
        invocation: 'user-slash',
        mode: 'inject',
        status: 'completed',
        timestamp: CREATED_AT,
      },
    ],
    memoryEvents: [{ type: 'memory_retrieved', at: CREATED_AT, topic: 'preserved-memory' }],
    usedMemoryReferences: [
      {
        topic: 'preserved-memory',
        path: '.agents/memory/preserved.md',
        score: 1,
        truncated: false,
      },
    ],
    contextReferences: [
      {
        id: 'context-1',
        sourcePath: '/source/AGENTS.md',
        relativePath: 'AGENTS.md',
        originalReference: 'AGENTS.md',
        loadType: 'system',
        status: 'active',
        byteLength: 42,
        loadedAt: CREATED_AT,
      },
    ],
    sandboxSnapshotId: 'snapshot-preserved',
    goal: {
      id: 'goal-1',
      objective: 'preserve all state',
      status: 'active',
      iterations: 1,
      maxIterations: 3,
      startedAt: CREATED_AT,
      progress: [{ iteration: 1, signal: 'continue', reason: 'still working' }],
    },
    plan: {
      id: 'plan-1',
      objective: 'prove record preservation',
      steps: [{ id: 'step-1', description: 're-save', status: 'in-progress' }],
      phase: 'executing',
      createdAt: CREATED_AT,
      approvedAt: CREATED_AT,
    },
    activeBranch: { branchId: 'branch-preserved', checkpointId: 'checkpoint-preserved' },
  };
}

describe('ARCH-015 Session record field preservation', () => {
  const scratchDirs: string[] = [];

  afterEach(() => {
    for (const scratchDir of scratchDirs.splice(0)) {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('implements the canonical interactive-session store port directly', () => {
    expectTypeOf<NodeSessionStore>().toMatchTypeOf<IInteractiveSessionStore>();
    expectTypeOf<IInteractiveSessionStore>().not.toHaveProperty('getFilePath');
  });

  it('preserves every non-owned field while refreshing Session-owned fields', async () => {
    const scratchDir = realpathSync(mkdtempSync(join(tmpdir(), 'arch-015-')));
    scratchDirs.push(scratchDir);
    const store = new NodeSessionStore(join(scratchDir, 'sessions'));
    const existing = createExistingRecord();
    store.save(existing);

    const session = new Session({
      cwd: scratchDir,
      tools: [],
      provider: new PreservationProvider(),
      systemMessage: 'live system prompt',
      terminal: silentTerminal,
      sessionStore: store,
      sessionId: SESSION_ID,
      defaultTrustLevel: 'full',
    });

    await expect(session.run('preserve-record-fields')).resolves.toBe(
      'arch-015:preserve-record-fields',
    );
    await session.shutdown();

    const reloaded = loadedOrMissing(store, SESSION_ID);
    expect(reloaded).toBeDefined();

    const preservedKeys = [
      'name',
      'backgroundTasks',
      'backgroundTaskEvents',
      'backgroundJobGroups',
      'backgroundJobGroupEvents',
      'skillActivationEvents',
      'memoryEvents',
      'usedMemoryReferences',
      'contextReferences',
      'sandboxSnapshotId',
      'goal',
      'plan',
      'activeBranch',
    ] as const satisfies readonly (keyof IInteractiveSessionRecord)[];

    for (const key of preservedKeys) {
      expect(reloaded?.[key], key).toEqual(existing[key]);
    }
    expect(reloaded?.createdAt).toBe(CREATED_AT);
    expect(reloaded?.cwd).toBe(scratchDir);
    expect(reloaded?.updatedAt).not.toBe(STALE_UPDATED_AT);
    expect(reloaded?.messages).not.toEqual(existing.messages);
    expect(reloaded?.history).not.toEqual(existing.history);
    expect(reloaded?.systemPrompt).toBe('live system prompt');
    expect(reloaded?.toolSchemas).toEqual([]);
  });
});
