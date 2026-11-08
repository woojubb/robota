/**
 * Attaching to a fork (live follow).
 *
 * One function decides what attaching to a fork's entry does, and the same table decides whether
 * the control is offered: a fork that is still running is FOLLOWED (its record is never opened, so
 * the job stays its one writer), one that has ended is CONTINUED as a session once nothing writes
 * its record, and anything else is refused in words that say why.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider, createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeForkedSessionRecord } from '../../interactive/interactive-session-fork-record.js';
import { createInProcessSubagentRunner } from '../../subagents/in-process-subagent-runner.js';
import { attachKind, resolveExecutionAttach } from '../execution-workspace-attach.js';
import { createExecutionWorkspaceSnapshot } from '../execution-workspace-projection.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { IResolvedConfig } from '../../config/config-types.js';
import type { ITerminalOutput, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ISubagentJobStart } from '@robota-sdk/agent-executor';
import type { TExecutionAttachFacts } from '../execution-workspace-attach.js';
import type {
  IAgentBackgroundTaskState,
  IExecutionWorkspaceEntry,
  TBackgroundTaskStatus,
} from '@robota-sdk/agent-interface/execution';

const testHost = createTestFrameworkHost();

const NOOP_TERMINAL: ITerminalOutput = {
  write: () => {},
  writeLine: () => {},
  writeMarkdown: () => {},
  writeError: () => {},
  prompt: () => Promise.resolve(''),
  select: () => Promise.resolve(0),
  spinner: () => ({ stop: () => {}, update: () => {} }),
};

const CONFIG = {
  provider: { name: 'scripted-test-provider', model: 'scripted-model' },
  permissions: { allow: [], deny: [] },
  defaultTrustLevel: 'moderate',
  currentProvider: 'scripted',
  env: {},
} as unknown as IResolvedConfig;

function message(content: string): TUniversalMessage {
  return {
    id: `m-${content.length}`,
    role: 'user',
    content,
    timestamp: new Date('2026-11-01T00:00:00.000Z'),
    state: 'complete',
  } as TUniversalMessage;
}

function job(cwd: string, resumeSessionId: string): ISubagentJobStart {
  return {
    taskId: 'agent_fork',
    request: {
      agentType: 'general-purpose',
      label: 'fork',
      mode: 'background',
      parentSessionId: 'session_parent',
      depth: 1,
      cwd,
      prompt: 'carry on',
      permissionPolicy: 'inherit-allowlist',
      resumeSessionId,
    },
  };
}

function forkTask(
  resumeSessionId: string,
  status: TBackgroundTaskStatus,
): IAgentBackgroundTaskState {
  return {
    id: 'agent_fork',
    kind: 'agent',
    label: 'experiment',
    status,
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 1,
    cwd: '/work',
    updatedAt: '2026-11-01T00:00:01.000Z',
    unread: false,
    agentType: 'general-purpose',
    resumeSessionId,
  };
}

/** The fork's entry as the parent's workspace projects it. */
function projectedFork(forkId: string, status: TBackgroundTaskStatus): IExecutionWorkspaceEntry {
  const snapshot = createExecutionWorkspaceSnapshot({
    sessionId: 'session_parent',
    mainThread: {
      sessionId: 'session_parent',
      isExecuting: false,
      hasPendingPrompt: false,
      historyLength: 0,
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    tasks: [forkTask(forkId, status)],
    groups: [],
  });
  const entry = snapshot.entries.find((candidate) => candidate.resumeSessionId === forkId);
  if (entry === undefined) throw new Error('the fork was not projected');
  return entry;
}

function storeFacts(store: NodeSessionStore): TExecutionAttachFacts {
  return {
    kind: 'store',
    hasSessionRecord: (id) => store.load(id).status === 'valid',
    hasWriter: (id) => store.hasWriter(id),
  };
}

function attach(store: NodeSessionStore, entry: IExecutionWorkspaceEntry) {
  return resolveExecutionAttach(entry, storeFacts(store));
}


const FORK = 'session_fork';
const RUNNING_STATUSES = ['queued', 'running', 'waiting_permission'] as const;
const ENDED_STATUSES = ['completed', 'failed', 'cancelled'] as const;

/** Facts of a store the test fully controls. */
function facts(options: { writer?: boolean; record?: boolean }): TExecutionAttachFacts {
  return {
    kind: 'store',
    hasWriter: () => options.writer ?? false,
    hasSessionRecord: () => options.record ?? true,
  };
}

describe('the one table behind the offer and the honour', () => {
  it.each(RUNNING_STATUSES)('a %s fork is followed', (status) => {
    expect(attachKind({ resumeSessionId: FORK, status })).toBe('follow');
  });

  it.each(ENDED_STATUSES)('a %s fork is continued', (status) => {
    expect(attachKind({ resumeSessionId: FORK, status })).toBe('continue');
  });

  it('an entry that resumed no record has nothing to attach to', () => {
    expect(attachKind({ status: 'running' })).toBe('none');
    expect(attachKind({ status: 'completed' })).toBe('none');
  });
});

describe('what attaching to a fork resolves to', () => {
  it.each(RUNNING_STATUSES)('follows a %s fork, whatever the record\'s writer', (status) => {
    const entry = projectedFork(FORK, status);

    for (const writer of [true, false]) {
      expect(resolveExecutionAttach(entry, facts({ writer }))).toEqual({
        type: 'follow',
        taskId: 'agent_fork',
        sessionId: FORK,
      });
    }
  });

  it('follows a running fork even when its record is gone: following reads no record', () => {
    expect(
      resolveExecutionAttach(projectedFork(FORK, 'running'), facts({ record: false })),
    ).toMatchObject({ type: 'follow' });
  });

  it.each(ENDED_STATUSES)('continues a %s fork nothing writes', (status) => {
    expect(resolveExecutionAttach(projectedFork(FORK, status), facts({}))).toEqual({
      type: 'switch-session',
      sessionId: FORK,
    });
  });

  it('refuses an ended fork whose record still has a writer, naming the writer and saying to retry', () => {
    const outcome = resolveExecutionAttach(
      projectedFork(FORK, 'completed'),
      facts({ writer: true }),
    );

    expect(outcome.type).toBe('refused');
    const reason = outcome.type === 'refused' ? outcome.reason : '';
    expect(reason).toContain('experiment has ended');
    expect(reason).toContain('still has a writer');
    expect(reason).toContain('Try again in a moment');
  });

  it('refuses an ended fork whose record is gone', () => {
    const outcome = resolveExecutionAttach(
      projectedFork(FORK, 'completed'),
      facts({ record: false }),
    );

    expect(outcome.type).toBe('refused');
    expect(outcome.type === 'refused' ? outcome.reason : '').toContain(
      `The forked session ${FORK} is no longer in the session store (completed)`,
    );
  });

  it('refuses an entry that is not a fork', () => {
    const { resumeSessionId: _dropped, ...plain } = projectedFork(FORK, 'running');

    const outcome = resolveExecutionAttach(plain, facts({}));

    expect(outcome.type === 'refused' ? outcome.reason : '').toContain('not a forked session');
  });

  it('lets a surface with no store continue an ended fork: the host\'s switch answers for the record', () => {
    expect(resolveExecutionAttach(projectedFork(FORK, 'completed'), { kind: 'host' })).toEqual({
      type: 'switch-session',
      sessionId: FORK,
    });
    expect(resolveExecutionAttach(projectedFork(FORK, 'running'), { kind: 'host' })).toMatchObject(
      { type: 'follow' },
    );
  });
});

describe('the control is offered for every fork and for nothing else', () => {
  it.each([...RUNNING_STATUSES, ...ENDED_STATUSES])('offers attach on a %s fork', (status) => {
    expect(projectedFork(FORK, status).controls).toContain('attach');
  });

  it('does not offer it on a task that resumed no record', () => {
    const { resumeSessionId: _dropped, ...plain } = forkTask(FORK, 'running');
    const snapshot = createExecutionWorkspaceSnapshot({
      sessionId: 'session_parent',
      mainThread: {
        sessionId: 'session_parent',
        isExecuting: false,
        hasPendingPrompt: false,
        historyLength: 0,
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      tasks: [plain],
      groups: [],
    });

    const task = snapshot.entries.find((entry) => entry.kind === 'background_task');

    expect(task?.controls).not.toContain('attach');
  });
});

describe('attaching against the store the writer lives in', () => {
  let cwd: string;
  let dir: string;

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'framework-attach-')));
    dir = join(cwd, 'sessions');
    mkdirSync(dir, { mode: 0o700 });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function fork(store: NodeSessionStore): string {
    return writeForkedSessionRecord({
      source: {
        getHistory: () => [message('the parent conversation')],
        getSystemMessage: () => 'the parent prompt',
        getToolSchemas: () => [],
      },
      fullHistory: () => [],
      sessionStore: store,
      requestedName: undefined,
      sourceName: 'parent',
      sourceId: 'session_parent',
      cwd,
    }).sessionId;
  }

  it('follows an in-process job that holds the record, and continues once the job has ended', async () => {
    const store = new NodeSessionStore(dir, { sealing: 'plain' });
    const forkId = fork(store);
    const runner = createInProcessSubagentRunner({
      host: testHost,
      config: CONFIG,
      context: { agentsMd: '', projectNotesMd: '' },
      tools: [],
      terminal: NOOP_TERMINAL,
      provider: createScriptedProvider([{ text: 'the fork answers' }]).provider,
      resumeSessionStore: store,
    });

    const handle = runner.start(job(cwd, forkId));
    expect(store.hasWriter(forkId)).toBe(true);
    expect(attach(store, projectedFork(forkId, 'running'))).toMatchObject({
      type: 'follow',
      sessionId: forkId,
    });

    await handle.result;
    expect(attach(store, projectedFork(forkId, 'completed'))).toEqual({
      type: 'switch-session',
      sessionId: forkId,
    });
  });

  it('follows a record lent to a child, refuses the ended job until the lease ends, then continues', () => {
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    const forkId = fork(store);
    const lease = store.lend(forkId);

    expect(attach(store, projectedFork(forkId, 'running')).type).toBe('follow');
    expect(attach(store, projectedFork(forkId, 'completed')).type).toBe('refused');

    lease.end();
    expect(attach(store, projectedFork(forkId, 'completed'))).toEqual({
      type: 'switch-session',
      sessionId: forkId,
    });
  });
});
