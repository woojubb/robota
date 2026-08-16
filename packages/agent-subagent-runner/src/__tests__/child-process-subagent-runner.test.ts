import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';
import type {
  ISubagentJobStart,
  ISubagentWorktreeAdapter,
  TBackgroundTaskRunnerEvent,
} from '@robota-sdk/agent-executor';
import {
  ChildProcessSubagentRunner,
  isSubagentWorkerChildMessage,
  isSubagentWorkerParentMessage,
} from '../index.js';

// DIST-006: the fixture stands in for the composition root's own entry — the runner now spawns
// `execPath args… --flag`, so a test worker is named the same way the real one is.
const FIXTURE_WORKER_ENTRY = {
  execPath: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/subagent-worker-fixture.mjs', import.meta.url))],
  execArgv: [] as readonly string[],
};
const TEST_TIMEOUT_MS = 20_000;

// The direct-constructor path never enables worktree isolation (that wrapping lives in the factory),
// so a no-op adapter satisfies the now-required option without affecting behavior.
const STUB_WORKTREE_ADAPTER: ISubagentWorktreeAdapter = {
  prepare: () => {
    throw new Error('not used');
  },
  isClean: () => true,
  remove: () => {},
};

function createDeps(): IInProcessSubagentRunnerDeps {
  return {
    config: {
      defaultTrustLevel: 'moderate',
      currentProvider: 'openai',
      provider: {
        name: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        baseURL: 'http://localhost:1234/v1',
      },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: 'agents', projectNotesMd: 'claude' },
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
    provider: {
      name: 'mock',
      chat: async () => ({
        role: 'assistant',
        content: 'unused',
        timestamp: new Date(),
      }),
    } as never,
    customAgentRegistry: () => ({
      name: 'tester',
      description: 'Test subagent',
      systemPrompt: 'Run test tasks.',
    }),
  };
}

function createJob(): ISubagentJobStart {
  return {
    taskId: 'agent_1',
    request: {
      permissionPolicy: 'inherit-allowlist' as const,
      agentType: 'tester',
      label: 'Tester',
      parentSessionId: 'session_1',
      mode: 'background',
      depth: 1,
      cwd: process.cwd(),
      prompt: 'do work',
    },
  };
}

function createJobWithEvents(events: TBackgroundTaskRunnerEvent[]): ISubagentJobStart {
  return {
    ...createJob(),
    emit: (event: TBackgroundTaskRunnerEvent) => events.push(event),
  };
}

describe('ChildProcessSubagentRunner', () => {
  it(
    'resolves with the child worker result and exposes the child pid',
    async () => {
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: FIXTURE_WORKER_ENTRY,
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start(createJob());
      const result = await handle.result;

      expect(handle.pid).toBeGreaterThan(0);
      expect(result).toEqual({ taskId: 'agent_1', output: 'completed:agent_1' });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'reports why a worker died instead of only its exit code (DIST-006)',
    async () => {
      // This is the defect's own diagnosability. DIST-006 presented as
      // `Subagent worker exited before result: exit code 1` because stderr was `'ignore'`, so the
      // real cause — `Cannot find module …` — went to a stream nothing read, and occurrence #2 had
      // to be bisected by hand. Pointing the entry at a module that does not exist reproduces
      // exactly that shape.
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: {
          execPath: process.execPath,
          args: [join(tmpdir(), 'robota-dist-006-no-such-worker.mjs')],
          execArgv: [],
        },
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start(createJob());

      await expect(handle.result).rejects.toThrow(/Cannot find module|MODULE_NOT_FOUND/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'forks the child into the job worktree, not the request cwd (ARCH-010/ARCH-031)',
    async () => {
      // Before ARCH-031 the worktree runner rewrote `request.cwd` to the worktree path, so forking on
      // `request.cwd` happened to be correct. The rewrite is gone — the worktree now rides on the
      // job envelope — and this asserts the fork followed it. `request.cwd` stays at the parent
      // checkout on purpose: it is the value the child must NOT land in.
      const worktreePath = realpathSync(mkdtempSync(join(tmpdir(), 'arch-031-worktree-')));
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: FIXTURE_WORKER_ENTRY,
        env: { ROBOTA_FIXTURE_MODE: 'cwd' },
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start({
        ...createJob(),
        worktree: { path: worktreePath, branch: 'subagent/arch-031' },
      });
      const result = await handle.result;

      expect(result.output).toBe(worktreePath);
      expect(result.output).not.toBe(process.cwd());
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'propagates the child worker token usage into the subagent result (ANALYTICS-001 P2)',
    async () => {
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: FIXTURE_WORKER_ENTRY,
        env: { ROBOTA_FIXTURE_MODE: 'usage' },
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start(createJob());
      const result = await handle.result;

      // The worker forwards sumHistoryUsage(...) over IPC; the runner must carry it onto the result
      // so the background-task tracker can attribute those tokens to this subagent's source.
      expect(result.usage).toEqual({ promptTokens: 300, completionTokens: 120, totalTokens: 420 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'emits text and tool progress messages from the child worker',
    async () => {
      const events: TBackgroundTaskRunnerEvent[] = [];
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: FIXTURE_WORKER_ENTRY,
        env: { ROBOTA_FIXTURE_MODE: 'progress' },
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start(createJobWithEvents(events));
      await handle.result;

      expect(events).toContainEqual({
        type: 'background_task_tool_start',
        toolName: 'Read',
        firstArg: 'file.ts',
      });
      expect(events).toContainEqual({ type: 'background_task_text_delta', delta: 'partial ' });
      expect(events).toContainEqual({
        type: 'background_task_tool_end',
        toolName: 'Read',
        success: true,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'exposes a deterministic transcript path and reads transcript pages',
    async () => {
      const logsDir = mkdtempSync(join(tmpdir(), 'robota-subagent-logs-'));
      const transcriptDir = join(logsDir, 'session_1', 'subagents');
      mkdirSync(transcriptDir, { recursive: true });
      writeFileSync(join(transcriptDir, 'agent_1.jsonl'), 'line1\nline2\n', 'utf8');
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: FIXTURE_WORKER_ENTRY,
        logsDir,
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start(createJob());
      const page = await handle.readLog?.({ offset: 0 });
      await handle.result;

      expect(handle.transcriptPath).toBe(join(transcriptDir, 'agent_1.jsonl'));
      expect(handle.logPath).toBe(join(transcriptDir, 'agent_1.jsonl'));
      expect(page?.lines).toEqual(['line1', 'line2']);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'forwards follow-up prompts through IPC',
    async () => {
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: FIXTURE_WORKER_ENTRY,
        env: { ROBOTA_FIXTURE_MODE: 'wait' },
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start(createJob());
      await handle.send?.('continue');
      const result = await handle.result;

      expect(result.output).toBe('sent:continue');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejects the result when the child worker acknowledges cancellation',
    async () => {
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: FIXTURE_WORKER_ENTRY,
        env: { ROBOTA_FIXTURE_MODE: 'wait' },
        killGraceMs: 1_000,
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start(createJob());
      await handle.cancel('stop requested');

      await expect(handle.result).rejects.toThrow('stop requested');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('subagent worker IPC guards', () => {
  it('accepts a well-formed start message and rejects malformed child messages', () => {
    expect(
      isSubagentWorkerParentMessage({
        type: 'start',
        payload: {
          taskId: 'agent_1',
          request: createJob().request,
          agentDefinition: {
            name: 'tester',
            description: 'Test subagent',
            systemPrompt: 'Run test tasks.',
          },
          parentConfig: createDeps().config,
          parentContext: createDeps().context,
          providerProfile: { type: 'openai', model: 'test-model', apiKey: 'test-key' },
        },
      }),
    ).toBe(true);
    expect(isSubagentWorkerChildMessage({ type: 'result' })).toBe(false);
  });
});
