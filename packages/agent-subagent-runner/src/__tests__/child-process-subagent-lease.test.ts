/**
 * #3679: a fork job's record is lent to its child process, in either mode, so it has one writer while
 * the child runs — the child, under the lease — and is free again once the child is gone.
 *
 * The child is the real worker entry over a plain store (the sealing fixture started plain), held
 * mid-run until the test releases it; the parent store is a real one over the same records.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveExecutionAttach } from '@robota-sdk/agent-framework';
import { createUserSessionStore } from '@robota-sdk/agent-framework/node';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChildProcessSubagentRunner } from '../index.js';

const spawning = vi.hoisted(() => ({
  fails: false,
  children: [] as import('node:child_process').ChildProcess[],
  /** What the parent's store said of the record when the child was spawned. */
  writerAtSpawn: [] as boolean[],
  probe: undefined as (() => boolean) | undefined,
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      if (spawning.probe !== undefined) spawning.writerAtSpawn.push(spawning.probe());
      if (spawning.fails) throw Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' });
      const child = actual.spawn(...args);
      spawning.children.push(child);
      return child;
    },
  };
});

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { ISubagentJobStart, ISubagentWorktreeAdapter } from '@robota-sdk/agent-executor';
import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';
import type { TResumeSessionStore } from '../index.js';

type IInteractiveSessionRecord = Parameters<TResumeSessionStore['save']>[0];

const TEST_TIMEOUT_MS = 30_000;
const FORK_ID = 'session_fork_lent';
const SEALING_WORKER = {
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
  for (const child of spawning.children.splice(0)) child.kill('SIGKILL');
  // A fork job's child and the parent's follower let the record's marker go just after the job's
  // result, so a removal can meet a marker or break lock written meanwhile; Node retries ENOTEMPTY.
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
  spawning.fails = false;
  spawning.writerAtSpawn.length = 0;
  spawning.probe = undefined;
});

function directory(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

function forkRecord(cwd: string): IInteractiveSessionRecord {
  return {
    id: FORK_ID,
    cwd,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        content: 'the parent conversation',
        timestamp: new Date('2026-11-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

function createDeps(store: TResumeSessionStore): IInProcessSubagentRunnerDeps {
  return {
    host: createTestFrameworkHost(),
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

function readEvents(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The running fork as the parent's execution workspace shows it. */
function runningFork(): Parameters<typeof resolveExecutionAttach>[0] {
  return {
    title: 'experiment',
    status: 'running',
    resumeSessionId: FORK_ID,
  } as unknown as Parameters<typeof resolveExecutionAttach>[0];
}

describe('a plain parent’s child-process fork', () => {
  it(
    'has one writer while it runs — attach and a second opener are refused — and none once it ends',
    async () => {
      const cwd = directory('lease-plain-');
      const recordPath = join(cwd, 'record.jsonl');
      const release = join(cwd, 'release');
      const sessions = join(cwd, 'sessions');
      const parent = createUserSessionStore(sessions, { sealing: 'plain' });
      parent.save(forkRecord(cwd), { handoff: true });
      const runner = new ChildProcessSubagentRunner(createDeps(parent), {
        logSealing: 'plain',
        workerEntry: SEALING_WORKER,
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        env: { SEALING_FIXTURE_RECORD: recordPath, SEALING_FIXTURE_HOLD_UNTIL: release },
      });

      const handle = runner.start(job(cwd));
      await vi.waitFor(() => expect(readEvents(recordPath)).toContainEqual({ chat: true }), {
        timeout: 15_000,
      });

      // The parent sees the writer, so attach is neither offered nor honoured.
      expect(parent.hasWriter(FORK_ID)).toBe(true);
      const attach = resolveExecutionAttach(runningFork(), {
        hasSessionRecord: (id) => parent.load(id).status === 'valid',
        hasWriter: (id) => parent.hasWriter(id),
      });
      expect(attach).toMatchObject({ type: 'refused', resumeSessionId: FORK_ID });
      // A second opener — this process is another one to the child — is refused, naming the child.
      let refusal: unknown;
      try {
        createUserSessionStore(sessions, { sealing: 'plain' }).claim(FORK_ID);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({
        reason: 'has_writer',
        holder: { pid: handle.pid, self: false },
      });

      writeFileSync(release, '');
      const result = await handle.result;
      expect(result.output).toBe('the child process answers');
      const child = spawning.children[0];
      await vi.waitFor(
        () => expect(child?.exitCode !== null && child?.connected === false).toBe(true),
        {
          timeout: 15_000,
        },
      );

      await vi.waitFor(() => expect(parent.hasWriter(FORK_ID)).toBe(false));
      expect(readdirSync(join(sessions, 'claims'))).toEqual([]);
      createUserSessionStore(sessions, { sealing: 'plain' }).claim(FORK_ID).release();
    },
    TEST_TIMEOUT_MS,
  );

  it('is lent before the child is spawned, and a spawn that fails ends the lease', () => {
    const cwd = directory('lease-spawn-fails-');
    const parent = createUserSessionStore(join(cwd, 'sessions'), { sealing: 'plain' });
    parent.save(forkRecord(cwd), { handoff: true });
    const runner = new ChildProcessSubagentRunner(createDeps(parent), {
      logSealing: 'plain',
      workerEntry: SEALING_WORKER,
      worktreeAdapter: NO_WORKTREES,
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
    });
    spawning.probe = () => parent.hasWriter(FORK_ID);
    spawning.fails = true;

    expect(() => runner.start(job(cwd))).toThrow('spawn EAGAIN');

    expect(spawning.writerAtSpawn).toEqual([true]);
    expect(parent.hasWriter(FORK_ID)).toBe(false);
    parent.claim(FORK_ID).release();
  });

  it('is refused before anything starts while the record has a writer already', () => {
    const cwd = directory('lease-held-');
    const parent = createUserSessionStore(join(cwd, 'sessions'), { sealing: 'plain' });
    parent.save(forkRecord(cwd), { handoff: true });
    const open = createUserSessionStore(join(cwd, 'sessions'), { sealing: 'plain' }).claim(FORK_ID);
    const runner = new ChildProcessSubagentRunner(createDeps(parent), {
      logSealing: 'plain',
      workerEntry: SEALING_WORKER,
      worktreeAdapter: NO_WORKTREES,
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
    });

    expect(() => runner.start(job(cwd))).toThrow(/already has a writer/);
    expect(spawning.children).toHaveLength(0);
    open.release();
  });
});
