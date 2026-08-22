import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { AbstractAIProvider } from '@robota-sdk/agent-core';
import {
  Session,
  SessionStore,
  type IInteractiveSessionRecord,
  type ISpinner,
  type ITerminalOutput,
} from '../src/index.js';

import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';

const SESSION_ID = 'arch-015-public-sdk';
const CREATED_AT = '2026-08-01T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-08-01T01:00:00.000Z';
const PRESERVED_FIELDS = [
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

class OfflineProvider extends AbstractAIProvider {
  override readonly name = 'arch-015-offline';
  override readonly version = '1.0.0';

  override async chat(
    messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    const content = messages.at(-1)?.content;
    return {
      id: `example-${Date.now()}-4`,
      role: 'assistant',
      content: `arch-015:${typeof content === 'string' ? content : ''}`,
      timestamp: new Date(),
      state: 'complete',
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
  writeError(_text: string): void {},
  async prompt(): Promise<string> {
    // A silent example terminal answers nothing rather than blocking; `ITerminalOutput` requires the
    // member, and a stub that omitted it only compiled because nothing typechecked this directory.
    return '';
  },
  async select(_options: string[], initialIndex = 0): Promise<number> {
    return initialIndex;
  },
  write(): void {},
  writeLine(): void {},
  writeMarkdown(): void {},
  spinner(): ISpinner {
    return { stop(): void {}, update(): void {} };
  },
};

function createExistingRecord(): IInteractiveSessionRecord {
  const task = {
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
  const group = {
    id: 'group-1',
    parentSessionId: SESSION_ID,
    waitPolicy: 'wait_all' as const,
    taskIds: [task.id],
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
        id: `example-${Date.now()}-5`,
        role: 'user',
        content: 'stale message',
        timestamp: new Date(STALE_UPDATED_AT),
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
    backgroundTasks: [task],
    backgroundTaskEvents: [{ type: 'background_task_completed', task }],
    backgroundJobGroups: [group],
    backgroundJobGroupEvents: [{ type: 'background_job_group_completed', group }],
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

function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const scratchDir = mkdtempSync(join(tmpdir(), 'arch-015-example-'));
  let cleanupRemoved = false;
  let output: Omit<Record<string, unknown>, 'cleanupRemoved'> | undefined;

  try {
    const store = new SessionStore(join(scratchDir, 'sessions'));
    const existing = createExistingRecord();
    store.save(existing);

    const session = new Session({
      cwd: scratchDir,
      tools: [],
      provider: new OfflineProvider(),
      systemMessage: 'live system prompt',
      terminal: silentTerminal,
      sessionStore: store,
      sessionId: SESSION_ID,
      defaultTrustLevel: 'full',
    });
    const assistantResponse = await session.run('preserve-record-fields');
    await session.shutdown();

    const reloaded = store.load(SESSION_ID);
    assertCondition(reloaded !== undefined, 'ARCH-015: persisted record was not reloadable');
    for (const key of PRESERVED_FIELDS) {
      assertCondition(
        isDeepStrictEqual(reloaded?.[key], existing[key]),
        `ARCH-015: ${key} was not preserved`,
      );
    }

    const sessionOwnedOverwrites = {
      cwd: reloaded?.cwd === scratchDir,
      updatedAt: reloaded?.updatedAt !== STALE_UPDATED_AT,
      messages: !isDeepStrictEqual(reloaded?.messages, existing.messages),
      history: !isDeepStrictEqual(reloaded?.history, existing.history),
      systemPrompt: reloaded?.systemPrompt === 'live system prompt',
      toolSchemas: isDeepStrictEqual(reloaded?.toolSchemas, []),
    };
    assertCondition(
      Object.values(sessionOwnedOverwrites).every(Boolean),
      'ARCH-015: a Session-owned field retained stale state',
    );
    assertCondition(reloaded?.createdAt === CREATED_AT, 'ARCH-015: createdAt changed');
    assertCondition(
      assistantResponse === 'arch-015:preserve-record-fields',
      'ARCH-015: unexpected provider response',
    );

    output = {
      scenario: 'ARCH-015',
      provider: 'arch-015-offline',
      assistantResponse,
      preservedFields: PRESERVED_FIELDS,
      preservedCount: PRESERVED_FIELDS.length,
      createdAtPreserved: true,
      sessionOwnedOverwrites,
    };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
    cleanupRemoved = !existsSync(scratchDir);
  }

  assertCondition(cleanupRemoved, 'ARCH-015: scratch cleanup failed');
  process.stdout.write(`${JSON.stringify({ ...output, cleanupRemoved })}\n`);
}

void main();
