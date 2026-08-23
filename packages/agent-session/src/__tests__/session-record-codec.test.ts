/**
 * TRANS-005 (#2081) — the versioned total decoder for a persisted interactive-session record.
 *
 * Two table-driven suites do most of the work, both built from ONE maximal fixture:
 *   1. a malformed corpus, asserting `corrupt` and never a throw;
 *   2. a single-field mutation per nested contract family, asserting the reported field PATH.
 *
 * The second is the property test the issue asks for, spelled as a table: no single-field mutation
 * of a valid record decodes as valid.
 */

import { describe, expect, it } from 'vitest';

import {
  INTERACTIVE_SESSION_RECORD_KEYS,
  INTERACTIVE_SESSION_RECORD_VERSION,
  decodeInteractiveSessionRecord,
  decodeVersionedInteractiveSessionRecord,
} from '../session-record-codec/index.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-transport';
import type { TSessionRecordDecodeOutcome } from '../session-record-codec/index.js';

/** A record with every optional field populated and every nested contract family present. */
function maximalRecord(): IInteractiveSessionRecord {
  return {
    id: 'session-1',
    name: 'a named session',
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    systemPrompt: 'be useful',
    sandboxSnapshotId: 'snapshot-1',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'hello',
        timestamp: new Date('2026-08-01T00:00:01.000Z'),
        state: 'complete',
        name: 'someone',
        metadata: { seen: true, count: 2, tag: 'x', tags: ['a'], scores: { a: 1 } },
        parts: [
          { type: 'text', text: 'hello' },
          { type: 'image_inline', mimeType: 'image/png', data: 'AAA' },
          { type: 'image_uri', uri: 'https://example.test/i.png', mimeType: 'image/png' },
        ],
      },
      {
        id: 'm2',
        role: 'assistant',
        content: null,
        timestamp: new Date('2026-08-01T00:00:02.000Z'),
        state: 'complete',
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{}' } }],
      },
      {
        id: 'm3',
        role: 'system',
        content: 'system text',
        timestamp: new Date('2026-08-01T00:00:03.000Z'),
        state: 'interrupted',
      },
      {
        id: 'm4',
        role: 'tool',
        content: 'tool output',
        timestamp: new Date('2026-08-01T00:00:04.000Z'),
        state: 'complete',
        toolCallId: 'c1',
        name: 'read',
      },
    ],
    history: [
      {
        id: 'h1',
        timestamp: new Date('2026-08-01T00:00:05.000Z'),
        category: 'chat',
        type: 'user',
        data: { anything: { nested: [1, 'two', false, null] } },
      },
    ],
    toolSchemas: [
      {
        name: 'read',
        description: 'read a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'the path' },
            depth: { type: 'integer', minimum: 0, maximum: 9, default: 1 },
            mode: { enum: ['a', 'b'] },
            either: { anyOf: [{ type: 'string' }, { type: 'number' }] },
            list: { type: 'array', items: { type: 'string' }, additionalProperties: false },
          },
          required: ['path'],
        },
        outputSchema: { type: 'string', pattern: '^.*$', format: 'uri' },
      },
    ],
    backgroundTasks: [
      {
        id: 't1',
        kind: 'agent',
        label: 'a task',
        agentType: 'general-purpose',
        status: 'completed',
        mode: 'background',
        parentSessionId: 'session-1',
        parentTaskId: 't0',
        depth: 1,
        cwd: '/work',
        pid: 4242,
        startedAt: '2026-08-01T00:01:00.000Z',
        updatedAt: '2026-08-01T00:02:00.000Z',
        lastActivityAt: '2026-08-01T00:01:30.000Z',
        completedAt: '2026-08-01T00:02:00.000Z',
        promptPreview: 'do the thing',
        commandPreview: 'ls',
        isolation: 'worktree',
        currentAction: 'writing',
        unread: false,
        logPath: '/logs/t1.log',
        transcriptPath: '/logs/t1.jsonl',
        worktreePath: '/wt/t1',
        branchName: 'feat/t1',
        worktreeStatus: 'clean',
        worktreeNextAction: 'none',
        worktreeBaseRevision: 'abc1234',
        parentWorktreeStatus: 'clean',
        timeoutReason: 'idle',
        nextFireAt: '2026-08-03T00:00:00.000Z',
        metadata: { retries: 0, flagged: false, owner: 'me' },
        schedule: {
          cronExpression: '0 * * * *',
          agentInstruction: 'wake up',
          command: 'echo hi',
          shell: '/bin/zsh',
          env: { KEY: 'value' },
        },
        result: {
          taskId: 't1',
          kind: 'agent',
          output: 'done',
          exitCode: 0,
          signalCode: 'SIGTERM',
          metadata: { lines: 12 },
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        },
        error: { category: 'timeout', message: 'too slow', recoverable: true },
      },
    ],
    backgroundTaskEvents: [
      { type: 'background_task_created', task: taskState() },
      { type: 'background_task_started', task: taskState() },
      { type: 'background_task_updated', task: taskState() },
      { type: 'background_task_text_delta', taskId: 't1', delta: 'chunk' },
      { type: 'background_task_tool_start', taskId: 't1', toolName: 'read', firstArg: 'a.ts' },
      { type: 'background_task_tool_end', taskId: 't1', toolName: 'read', success: true },
      {
        type: 'background_task_permission_request',
        taskId: 't1',
        requestId: 'r1',
        toolName: 'write',
        toolArgs: { path: 'a.ts', force: false, retries: 1 },
      },
      { type: 'background_task_completed', task: taskState() },
      { type: 'background_task_failed', task: taskState() },
      { type: 'background_task_cancelled', task: taskState() },
      { type: 'background_task_closed', taskId: 't1' },
      { type: 'background_task_waking', taskId: 't1', instruction: 'continue' },
    ],
    backgroundJobGroups: [
      {
        id: 'g1',
        parentSessionId: 'session-1',
        waitPolicy: 'wait_all',
        taskIds: ['t1'],
        status: 'completed',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:03:00.000Z',
        label: 'a group',
        completedAt: '2026-08-01T00:03:00.000Z',
        results: [
          {
            taskId: 't1',
            label: 'a task',
            status: 'completed',
            summary: 'ok',
            outputRef: '/logs/t1.log',
            startedAt: '2026-08-01T00:01:00.000Z',
            completedAt: '2026-08-01T00:02:00.000Z',
            error: { category: 'runner', message: 'noted', recoverable: false },
          },
        ],
      },
    ],
    backgroundJobGroupEvents: [
      { type: 'background_job_group_created', group: jobGroupState() },
      { type: 'background_job_group_updated', group: jobGroupState() },
      { type: 'background_job_group_completed', group: jobGroupState() },
    ],
    skillActivationEvents: [
      {
        type: 'skill-activation',
        skillName: 'a-skill',
        source: 'plugin',
        invocation: 'model-tool',
        mode: 'fork',
        status: 'failed',
        timestamp: '2026-08-01T00:04:00.000Z',
        qualifiedName: 'plugin:a-skill',
        error: 'it failed',
      },
    ],
    memoryEvents: [
      {
        type: 'memory_candidate_saved',
        at: '2026-08-01T00:05:00.000Z',
        candidateId: 'c1',
        topic: 'a topic',
        reason: 'because',
        data: { nested: { ok: true }, list: [1, 2] },
      },
    ],
    usedMemoryReferences: [{ topic: 'a topic', path: '/mem/a.md', score: 0.5, truncated: false }],
    contextReferences: [
      {
        id: 'r1',
        sourcePath: '/work/AGENTS.md',
        relativePath: 'AGENTS.md',
        originalReference: '@AGENTS.md',
        loadType: 'prompt-reference',
        status: 'active',
        byteLength: 120,
        loadedAt: '2026-08-01T00:06:00.000Z',
        lastUsedAt: '2026-08-01T00:07:00.000Z',
      },
    ],
    goal: {
      id: 'goal-1',
      objective: 'finish it',
      status: 'stopped',
      stopReason: 'no-progress',
      iterations: 3,
      maxIterations: 10,
      startedAt: '2026-08-01T00:08:00.000Z',
      progress: [{ iteration: 1, signal: 'continue', reason: 'more to do' }],
    },
    plan: {
      id: 'plan-1',
      objective: 'plan it',
      steps: [{ id: 's1', description: 'first', status: 'done' }],
      phase: 'executing',
      createdAt: '2026-08-01T00:09:00.000Z',
      approvedAt: '2026-08-01T00:10:00.000Z',
    },
    activeBranch: { branchId: 'b1', checkpointId: 'cp1' },
  };
}

function taskState() {
  return maximalRecordTask();
}

function maximalRecordTask() {
  return {
    id: 't1',
    kind: 'agent' as const,
    label: 'a task',
    status: 'running' as const,
    mode: 'background' as const,
    parentSessionId: 'session-1',
    depth: 0,
    cwd: '/work',
    updatedAt: '2026-08-01T00:02:00.000Z',
    unread: true,
  };
}

function jobGroupState() {
  return {
    id: 'g1',
    parentSessionId: 'session-1',
    waitPolicy: 'detached' as const,
    taskIds: ['t1'],
    status: 'running' as const,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:03:00.000Z',
    results: [],
  };
}

/** The record as it comes back off disk: JSON, so every `Date` has become a string. */
function persisted(record: IInteractiveSessionRecord = maximalRecord()): unknown {
  return JSON.parse(JSON.stringify(record)) as unknown;
}

/** Mutate one field, addressed by a dotted/bracketed path, on a fresh persisted copy. */
function persistedWith(path: string, value: unknown): unknown {
  const root = persisted() as Record<string, unknown>;
  const steps = path.split(/\.|\[|\]\.?/).filter((step) => step.length > 0);
  const last = steps.pop() as string;
  let cursor: Record<string, unknown> = root;
  for (const step of steps) {
    cursor = cursor[step] as Record<string, unknown>;
  }
  if (value === undefined) delete cursor[last];
  else cursor[last] = value;
  return root;
}

function issuePaths(outcome: TSessionRecordDecodeOutcome): string[] {
  return outcome.status === 'corrupt' ? outcome.issues.map((issue) => issue.path) : [];
}

describe('decodeInteractiveSessionRecord — TC-01 total over unknown input', () => {
  const corpus: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a JSON string', '{}'],
    ['an array', []],
    ['an empty object', {}],
    ['a boolean', true],
    ['a record missing every required field', { name: 'x' }],
    [
      'a record whose messages are absent',
      {
        id: 'a',
        cwd: '/',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  ];

  it.each(corpus)('reports %s as corrupt without throwing', (_label, value) => {
    expect(() => decodeInteractiveSessionRecord(value)).not.toThrow();
    const outcome = decodeInteractiveSessionRecord(value);
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') expect(outcome.issues.length).toBeGreaterThan(0);
  });
});

describe('decodeInteractiveSessionRecord — TC-02 a maximal record round-trips', () => {
  it('decodes a persisted maximal record to valid', () => {
    const outcome = decodeInteractiveSessionRecord(persisted());
    if (outcome.status !== 'valid') {
      throw new Error(`expected valid, got ${outcome.status}: ${JSON.stringify(outcome, null, 2)}`);
    }
    expect(outcome.record).toEqual(maximalRecord());
  });

  it('revives the contract-declared Date members as Date instances', () => {
    const outcome = decodeInteractiveSessionRecord(persisted());
    if (outcome.status !== 'valid') throw new Error('expected valid');
    for (const message of outcome.record.messages) {
      expect(message.timestamp).toBeInstanceOf(Date);
    }
    for (const entry of outcome.record.history ?? []) {
      expect(entry.timestamp).toBeInstanceOf(Date);
    }
    expect(outcome.record.messages[0]?.timestamp.toISOString()).toBe('2026-08-01T00:00:01.000Z');
  });

  it('accepts a record that is already in memory, with real Date members', () => {
    const outcome = decodeInteractiveSessionRecord(maximalRecord());
    expect(outcome.status).toBe('valid');
  });
});

describe('decodeInteractiveSessionRecord — TC-03 every nested family reports its path', () => {
  const mutations: Array<[string, string, unknown]> = [
    ['root scalar', 'id', 42],
    ['message base', 'messages[0].state', 'halfway'],
    ['message variant', 'messages[1].content', 7],
    ['message part', 'messages[0].parts[1].mimeType', null],
    ['tool call', 'messages[1].toolCalls[0].function', 'read'],
    ['history entry', 'history[0].category', 5],
    ['tool schema', 'toolSchemas[0].name', null],
    ['parameter schema', 'toolSchemas[0].parameters.properties.path.type', 'stringy'],
    ['background task', 'backgroundTasks[0].depth', 'deep'],
    ['background task result', 'backgroundTasks[0].result.output', 12],
    ['background task error', 'backgroundTasks[0].error.category', 'nope'],
    ['background task schedule', 'backgroundTasks[0].schedule.cronExpression', 3],
    ['background task event', 'backgroundTaskEvents[3].delta', 9],
    ['background task event payload', 'backgroundTaskEvents[0].task.id', null],
    ['job group', 'backgroundJobGroups[0].waitPolicy', 'whenever'],
    ['job group result', 'backgroundJobGroups[0].results[0].status', 'nearly'],
    ['job group event', 'backgroundJobGroupEvents[0].group.taskIds', 't1'],
    ['skill activation', 'skillActivationEvents[0].mode', 'sideways'],
    ['memory event', 'memoryEvents[0].type', 'memory_candidate_eaten'],
    ['memory reference', 'usedMemoryReferences[0].score', 'high'],
    ['context reference', 'contextReferences[0].byteLength', '120'],
    ['goal', 'goal.iterations', 'three'],
    ['goal progress', 'goal.progress[0].signal', 'maybe'],
    ['plan', 'plan.phase', 'pending'],
    ['plan step', 'plan.steps[0].status', 'started'],
    ['active branch', 'activeBranch.checkpointId', 12],
  ];

  it.each(mutations)('%s: a defect at %s is reported at that path', (_family, path, value) => {
    const outcome = decodeInteractiveSessionRecord(persistedWith(path, value));
    expect(outcome.status).toBe('corrupt');
    expect(issuePaths(outcome)).toContain(path);
  });

  it('reports a missing required nested field at its own path', () => {
    const outcome = decodeInteractiveSessionRecord(persistedWith('goal.objective', undefined));
    expect(issuePaths(outcome)).toContain('goal.objective');
  });
});

describe('decodeInteractiveSessionRecord — TC-04 date revival', () => {
  it('accepts an ISO-8601 string', () => {
    const outcome = decodeInteractiveSessionRecord(
      persistedWith('messages[0].timestamp', '2026-08-01T00:00:09.000Z'),
    );
    if (outcome.status !== 'valid') throw new Error('expected valid');
    expect(outcome.record.messages[0]?.timestamp.toISOString()).toBe('2026-08-01T00:00:09.000Z');
  });

  it('accepts a Date instance', () => {
    const record = maximalRecord();
    const outcome = decodeInteractiveSessionRecord(record);
    if (outcome.status !== 'valid') throw new Error('expected valid');
    expect(outcome.record.messages[0]?.timestamp.getTime()).toBe(
      record.messages[0]?.timestamp.getTime(),
    );
  });

  it.each([['not-a-date'], [''], [0], [null], [{}]])(
    'rejects %s at messages[0].timestamp',
    (value) => {
      const outcome = decodeInteractiveSessionRecord(persistedWith('messages[0].timestamp', value));
      expect(outcome.status).toBe('corrupt');
      expect(issuePaths(outcome)).toContain('messages[0].timestamp');
    },
  );
});

describe('decodeInteractiveSessionRecord — TC-05 string timestamps must parse', () => {
  it('rejects an updatedAt that Date.parse cannot read', () => {
    const outcome = decodeInteractiveSessionRecord(persistedWith('updatedAt', 'last thursday'));
    expect(outcome.status).toBe('corrupt');
    expect(issuePaths(outcome)).toContain('updatedAt');
  });

  it('rejects an empty createdAt', () => {
    expect(issuePaths(decodeInteractiveSessionRecord(persistedWith('createdAt', '')))).toContain(
      'createdAt',
    );
  });

  it('keeps a valid string timestamp a string', () => {
    const outcome = decodeInteractiveSessionRecord(persisted());
    if (outcome.status !== 'valid') throw new Error('expected valid');
    expect(typeof outcome.record.updatedAt).toBe('string');
  });
});

describe('decodeInteractiveSessionRecord — TC-06 unknown keys', () => {
  it.each([
    ['the root', 'surprise'],
    ['a message', 'messages[0].surprise'],
    ['a background task', 'backgroundTasks[0].surprise'],
    ['the goal', 'goal.surprise'],
  ])('rejects an unknown key on %s', (_where, path) => {
    const outcome = decodeInteractiveSessionRecord(persistedWith(path, 'x'));
    expect(outcome.status).toBe('corrupt');
    expect(issuePaths(outcome)).toContain(path);
  });

  it.each([
    ['history data', 'history[0].data.surprise'],
    ['message metadata', 'messages[0].metadata.surprise'],
    ['memory event data', 'memoryEvents[0].data.surprise'],
    ['task metadata', 'backgroundTasks[0].metadata.surprise'],
  ])('permits an unknown key inside %s', (_where, path) => {
    const outcome = decodeInteractiveSessionRecord(persistedWith(path, 'x'));
    expect(outcome.status).toBe('valid');
  });

  // A member ANOTHER variant declares is the case that separates per-variant key sets from one
  // union of all four. An implementation using the union would accept every one of these, and every
  // other unknown-key assertion in this file would stay green — so without these three the
  // discriminated key set is correct by construction and verified by nothing.
  it.each([
    ['toolCallId on a user message', 'messages[0].toolCallId', 'c1'],
    ['toolCalls on a user message', 'messages[0].toolCalls', []],
    ['name on an assistant message', 'messages[1].name', 'someone'],
    ['toolCallId on an assistant message', 'messages[1].toolCallId', 'c1'],
  ])('rejects %s — a member only another variant declares', (_case, path, value) => {
    const outcome = decodeInteractiveSessionRecord(persistedWith(path, value));
    expect(outcome.status).toBe('corrupt');
    expect(issuePaths(outcome)).toContain(path);
  });

  it('permits an unknown property name inside a tool schema properties map', () => {
    const outcome = decodeInteractiveSessionRecord(
      persistedWith('toolSchemas[0].parameters.properties.surprise', { type: 'string' }),
    );
    expect(outcome.status).toBe('valid');
  });
});

describe('decodeVersionedInteractiveSessionRecord — TC-07 version gate', () => {
  it('decodes an envelope at the current version', () => {
    const outcome = decodeVersionedInteractiveSessionRecord({
      schemaVersion: INTERACTIVE_SESSION_RECORD_VERSION,
      record: persisted(),
    });
    expect(outcome.status).toBe('valid');
  });

  it.each([[0], [2], [1.5], [-1]])('reports version %s as unsupported', (version) => {
    const outcome = decodeVersionedInteractiveSessionRecord({
      schemaVersion: version,
      record: persisted(),
    });
    expect(outcome).toEqual({ status: 'unsupported', schemaVersion: version });
  });

  it.each([
    ['a string version', '1'],
    ['an absent version', undefined],
    ['a null version', null],
  ])('reports %s as unsupported with schemaVersion undefined', (_label, version) => {
    const envelope: Record<string, unknown> = { record: persisted() };
    if (version !== undefined) envelope['schemaVersion'] = version;
    expect(decodeVersionedInteractiveSessionRecord(envelope)).toEqual({
      status: 'unsupported',
      schemaVersion: undefined,
    });
  });

  it('does not report nested field issues for an unsupported version', () => {
    const outcome = decodeVersionedInteractiveSessionRecord({
      schemaVersion: 99,
      record: { total: 'garbage' },
    });
    expect(outcome.status).toBe('unsupported');
    expect('issues' in outcome).toBe(false);
  });

  it('reports a non-envelope as corrupt rather than unsupported', () => {
    expect(decodeVersionedInteractiveSessionRecord(null).status).toBe('corrupt');
    expect(decodeVersionedInteractiveSessionRecord([]).status).toBe('corrupt');
  });

  it('reports a valid envelope carrying a corrupt record as corrupt', () => {
    const outcome = decodeVersionedInteractiveSessionRecord({
      schemaVersion: INTERACTIVE_SESSION_RECORD_VERSION,
      record: persistedWith('id', 42),
    });
    expect(outcome.status).toBe('corrupt');
    expect(issuePaths(outcome)).toContain('record.id');
  });
});

describe('decodeInteractiveSessionRecord — TC-08 issues accumulate', () => {
  it('reports every independent defect in one outcome', () => {
    const broken = persisted() as Record<string, unknown>;
    broken['id'] = 42;
    broken['cwd'] = null;
    const outcome = decodeInteractiveSessionRecord(broken);
    expect(issuePaths(outcome)).toEqual(expect.arrayContaining(['id', 'cwd']));
  });

  it('carries a message on every issue', () => {
    const outcome = decodeInteractiveSessionRecord({});
    if (outcome.status !== 'corrupt') throw new Error('expected corrupt');
    for (const issue of outcome.issues) {
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });
});

describe('TC-09 key parity between the contract and the decoder', () => {
  it('decodes every key the record contract declares', () => {
    const declared = {
      id: true,
      name: true,
      cwd: true,
      createdAt: true,
      updatedAt: true,
      messages: true,
      history: true,
      systemPrompt: true,
      toolSchemas: true,
      backgroundTasks: true,
      backgroundTaskEvents: true,
      backgroundJobGroups: true,
      backgroundJobGroupEvents: true,
      skillActivationEvents: true,
      memoryEvents: true,
      usedMemoryReferences: true,
      contextReferences: true,
      sandboxSnapshotId: true,
      goal: true,
      plan: true,
      activeBranch: true,
    } satisfies Record<keyof IInteractiveSessionRecord, true>;

    expect([...INTERACTIVE_SESSION_RECORD_KEYS].sort()).toEqual(Object.keys(declared).sort());
  });

  it('exports a schema version', () => {
    expect(Number.isInteger(INTERACTIVE_SESSION_RECORD_VERSION)).toBe(true);
  });
});
