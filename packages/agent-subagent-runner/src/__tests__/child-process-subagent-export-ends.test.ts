/**
 * A fork job whose start fails before its child can be followed leaves its record free (#3679).
 *
 * Handing a sealed fork record to a child marks it exported: nothing in this process may claim it,
 * adopt it or tag it while the child may still save it, and only the parent's follower of the
 * child ends that. So a start that fails before the follower exists must not have exported the
 * record at all — a record past the wire bound, or a spawn that throws — or the id would stay
 * unclaimable for the life of the process.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createUserSessionStore } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChildProcessSubagentRunner } from '../index.js';

const spawning = vi.hoisted(() => ({ fails: false, children: 0 }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      if (spawning.fails) throw Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' });
      spawning.children += 1;
      return actual.spawn(...args);
    },
  };
});

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { ISubagentJobStart, ISubagentWorktreeAdapter } from '@robota-sdk/agent-executor';
import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';
import type { TResumeSessionStore } from '../index.js';

type IInteractiveSessionRecord = Parameters<TResumeSessionStore['save']>[0];

const FORK_ID = 'session_fork_unstarted';
const ECHO_WORKER = {
  execPath: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/sealing-worker-entry.mjs', import.meta.url))],
  execArgv: [] as readonly string[],
};
const TEST_PROVIDER_DEFINITIONS: readonly IProviderDefinition[] = [
  { type: 'openai', destinationEnvironment: [], createProvider: () => ({}) as never },
];
const NO_WORKTREES: ISubagentWorktreeAdapter = {
  prepare: () => {
    throw new Error('not used');
  },
  isClean: () => true,
  remove: () => {},
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  spawning.fails = false;
  spawning.children = 0;
});

function directory(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'export-ends-')));
  roots.push(dir);
  return dir;
}

function forkRecord(cwd: string, text: string): IInteractiveSessionRecord {
  return {
    id: FORK_ID,
    cwd,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-11-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
  } as IInteractiveSessionRecord;
}

function createDeps(store: TResumeSessionStore): IInProcessSubagentRunnerDeps {
  return {
    config: {
      defaultTrustLevel: 'moderate',
      currentProvider: 'openai',
      provider: { name: 'openai', model: 'test-model', apiKey: 'test-key' },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: '', projectNotesMd: '' },
    tools: [],
    terminal: {
      write: () => {},
      writeLine: () => {},
      writeMarkdown: () => {},
      writeError: () => {},
      prompt: () => Promise.resolve(''),
      select: () => Promise.resolve(0),
      spinner: () => ({ stop: () => {}, update: () => {} }),
    },
    provider: {} as never,
    customAgentRegistry: () => ({
      name: 'tester',
      description: 'Test subagent',
      systemPrompt: 'Run test tasks.',
    }),
    resumeSessionStore: store,
  };
}

function job(cwd: string): ISubagentJobStart {
  return {
    taskId: 'agent_1',
    request: {
      permissionPolicy: 'inherit-allowlist',
      agentType: 'tester',
      label: 'Tester',
      parentSessionId: 'session_parent',
      mode: 'background',
      depth: 1,
      cwd,
      prompt: 'Continue the forked record.',
      resumeSessionId: FORK_ID,
    },
  };
}

/** A sealing parent whose `/fork` left `text` for the job, and its runner. */
function sealingParent(text: string) {
  const cwd = directory();
  const sealer = createTestArtifactSealer();
  const store = createUserSessionStore(join(cwd, 'sessions'), { sealing: { sealer } });
  store.save(forkRecord(cwd, text), { handoff: true, provenance: 'owner' });
  const runner = new ChildProcessSubagentRunner(createDeps(store), {
    workerEntry: ECHO_WORKER,
    worktreeAdapter: NO_WORKTREES,
    providerDefinitions: TEST_PROVIDER_DEFINITIONS,
    logSealing: { sealer },
  });
  return { cwd, store, runner };
}

/** Whether another session of this process could take the id now; the probe claim is let go at once. */
function claimable(store: TResumeSessionStore): boolean {
  try {
    store.claim(FORK_ID).release();
    return true;
  } catch {
    return false;
  }
}

describe('a fork job whose start fails before its child is followed', () => {
  it('leaves a record past the wire bound unexported and free to claim', () => {
    // Its handover token, base64 of the envelope, is past the 32 MiB bound.
    const { cwd, store, runner } = sealingParent('x'.repeat(25 * 1024 * 1024));

    expect(() => runner.start(job(cwd))).toThrow(/too large to hand to a subagent/);

    expect(spawning.children).toBe(0);
    expect(store.hasWriter(FORK_ID)).toBe(false);
    expect(claimable(store)).toBe(true);
  });

  it('leaves the record unexported and free to claim when the spawn itself throws', () => {
    const { cwd, store, runner } = sealingParent('the parent conversation');
    spawning.fails = true;

    expect(() => runner.start(job(cwd))).toThrow('spawn EAGAIN');

    expect(store.hasWriter(FORK_ID)).toBe(false);
    expect(claimable(store)).toBe(true);
  });
});
