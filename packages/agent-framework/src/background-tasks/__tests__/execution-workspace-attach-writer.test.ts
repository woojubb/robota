/**
 * Attaching to a fork whose record something in this process is still writing (#3679 step 3e).
 *
 * Attaching opens the fork's record as a second session. While a job in this process runs the fork
 * (its claim), or a child process it was handed to may still save it (its export), that second
 * session would be a second writer of one record, so the control is neither offered nor honoured,
 * and both answers come from the one fact the store keeps: whether the record has a writer here.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider, createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeForkedSessionRecord } from '../../interactive/interactive-session-fork-record.js';
import { createInProcessSubagentRunner } from '../../subagents/in-process-subagent-runner.js';
import { resolveExecutionAttach } from '../execution-workspace-attach.js';
import { createExecutionWorkspaceSnapshot } from '../execution-workspace-projection.js';

import type { IResolvedConfig } from '../../config/config-types.js';
import type { ITerminalOutput, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ISubagentJobStart } from '@robota-sdk/agent-executor';
import type {
  IAgentBackgroundTaskState,
  IExecutionWorkspaceEntry,
  TBackgroundTaskStatus,
} from '@robota-sdk/agent-interface-execution';

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

const WRITER_REFUSAL = 'is still running as a subagent job';

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

/** The fork's entry as the parent's workspace projects it, reading the store's one fact. */
function projectedFork(
  store: NodeSessionStore,
  forkId: string,
  status: TBackgroundTaskStatus,
): IExecutionWorkspaceEntry {
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
    sessionHasWriter: (id) => store.hasWriter(id),
  });
  const entry = snapshot.entries.find((candidate) => candidate.resumeSessionId === forkId);
  if (entry === undefined) throw new Error('the fork was not projected');
  return entry;
}

function attach(store: NodeSessionStore, entry: IExecutionWorkspaceEntry) {
  return resolveExecutionAttach(entry, {
    hasSessionRecord: (id) => store.load(id).status === 'valid',
    hasWriter: (id) => store.hasWriter(id),
  });
}

describe('attaching to a fork that has a writer in this process', () => {
  let cwd: string;
  let dir: string;

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'framework-attach-writer-')));
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

  it('is neither offered nor honoured while an in-process job runs it, in a store that seals nothing', async () => {
    const store = new NodeSessionStore(dir, { sealing: 'plain' });
    const forkId = fork(store);
    const runner = createInProcessSubagentRunner({
      config: CONFIG,
      context: { agentsMd: '', projectNotesMd: '' },
      tools: [],
      terminal: NOOP_TERMINAL,
      provider: createScriptedProvider([{ text: 'the fork answers' }]).provider,
      resumeSessionStore: store,
    });

    const handle = runner.start(job(cwd, forkId));
    const running = projectedFork(store, forkId, 'running');

    expect(running.controls).not.toContain('attach');
    const refused = attach(store, running);
    expect(refused).toMatchObject({ type: 'refused', resumeSessionId: forkId });
    expect(refused.type === 'refused' ? refused.reason : '').toContain(
      `experiment ${WRITER_REFUSAL}`,
    );

    await handle.result;
    const ended = attach(store, projectedFork(store, forkId, 'completed'));
    expect(ended.type === 'refused' ? ended.reason : '').toContain('experiment is completed');
  });

  it('is offered and honoured for a fork nothing here writes (a child process, plainly)', () => {
    const store = new NodeSessionStore(dir, { sealing: 'plain' });
    const forkId = fork(store);

    const entry = projectedFork(store, forkId, 'running');

    expect(entry.controls).toContain('attach');
    expect(attach(store, entry)).toEqual({ type: 'switch-session', sessionId: forkId });
  });

  it('is neither offered nor honoured while the record is handed to a child, and is once that ends', () => {
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    const forkId = fork(store);
    expect(store.exportHeld?.(forkId, { handoffOnly: true })).toBeDefined();

    const exported = projectedFork(store, forkId, 'running');
    expect(exported.controls).not.toContain('attach');
    expect(attach(store, exported).type).toBe('refused');

    store.authorship?.exportEnded(forkId);
    const free = projectedFork(store, forkId, 'running');
    expect(free.controls).toContain('attach');
    expect(attach(store, free)).toEqual({ type: 'switch-session', sessionId: forkId });
  });
});
