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
    "keeps the END of a noisy child's stderr, not its beginning (DIST-006)",
    async () => {
      // The tail is bounded, so which END it keeps is the whole question: a subagent worker is
      // routinely noisy (the CLI installs a `[robota]` stderr sink in it), and the cause of a death
      // is the LAST thing written, never the first. This child writes ~240 KB of noise before the
      // line that matters, so a tail that kept the head would hold only warmup.
      //
      // Review proposed deferring the read to `'close'` to beat a drain race. Measured, that is not
      // the mechanism — see the comment at the read site — so this pins the bound's direction
      // rather than a wait.
      const noisyWorker = join(mkdtempSync(join(tmpdir(), 'robota-dist-006-noisy-')), 'noisy.mjs');
      writeFileSync(
        noisyWorker,
        [
          // `process.exit()` truncates pending pipe writes, so the fixture sets `exitCode` and lets
          // the process end naturally — otherwise the child never writes its last line and the test
          // measures the fixture rather than the runner.
          "process.stderr.write('warmup line\\n'.repeat(20000));",
          "process.stderr.write('FATAL: the cause is the LAST thing written\\n');",
          'process.exitCode = 1;',
        ].join('\n'),
        'utf8',
      );

      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: { execPath: process.execPath, args: [noisyWorker], execArgv: [] },
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start(createJob());

      await expect(handle.result).rejects.toThrow(/FATAL: the cause is the LAST thing written/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses an entry that never enters worker mode instead of waiting forever (DIST-006)',
    async () => {
      // `startCli` is a public export and the SPEC advertises alternate embeddings, so an embedder
      // can wire `workerEntry` to an entry that does NOT dispatch worker mode. Self-fork then starts
      // a second copy of THEIR app with an IPC channel and no `ready`. `request.timeoutMs` is
      // optional, so without a handshake deadline the parent waits forever — a silent hang, where
      // the seam this replaced failed loudly.
      const silentEntry = join(
        mkdtempSync(join(tmpdir(), 'robota-dist-006-silent-')),
        'silent.mjs',
      );
      writeFileSync(silentEntry, 'setTimeout(() => {}, 60_000);\n', 'utf8');

      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: { execPath: process.execPath, args: [silentEntry], execArgv: [] },
        // The production budget is 30s — longer than this file's own test timeout, so a test that
        // relied on it could only ever pass through the REQUEST timeout instead, leaving this
        // branch shipped untested. Injecting the budget is what makes the assertion reach it.
        handshakeBudgetMs: 300,
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      // Deliberately NO `request.timeoutMs`: that is the other path, and it would mask this one.
      const handle = runner.start(createJob());

      await expect(handle.result).rejects.toThrow(/never signalled ready/);
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

describe('ChildProcessSubagentRunner — injected built-in agents (ARCH-036)', () => {
  // NEUT-003 made an injected `builtInAgents` set REPLACE the module built-ins, and an empty array
  // remove them entirely. The in-process sibling honoured it; this runner read only
  // `customAgentRegistry`, so the composition root's choice reached one runner and not the other.
  // Every case here drives the real runner, because the defect was that a field on the shared deps
  // type was never read — an assertion on a helper would not have caught it either.
  const jobFor = (agentType: string): ISubagentJobStart => ({
    ...createJob(),
    request: { ...createJob().request, agentType },
  });

  const depsWithBuiltIns = (
    builtInAgents: IInProcessSubagentRunnerDeps['builtInAgents'],
  ): IInProcessSubagentRunnerDeps => ({
    ...createDeps(),
    customAgentRegistry: () => undefined,
    ...(builtInAgents === undefined ? {} : { builtInAgents }),
  });

  const startWith = (deps: IInProcessSubagentRunnerDeps, agentType: string) => {
    const runner = new ChildProcessSubagentRunner(deps, {
      workerEntry: FIXTURE_WORKER_ENTRY,
      worktreeAdapter: STUB_WORKTREE_ADAPTER,
    });
    return runner.start(jobFor(agentType));
  };

  it('an empty injected set removes the module built-ins', () => {
    expect(() => startWith(depsWithBuiltIns([]), 'general-purpose')).toThrow(
      /Unknown agent type: general-purpose/,
    );
  });

  it('an injected set REPLACES the module built-ins rather than extending them', () => {
    const injected = [
      {
        name: 'only-this-one',
        description: 'the sole agent this composition root offers',
        prompt: 'do the one thing',
      },
    ] as unknown as IInProcessSubagentRunnerDeps['builtInAgents'];

    expect(() => startWith(depsWithBuiltIns(injected), 'general-purpose')).toThrow(
      /Unknown agent type: general-purpose/,
    );
    expect(() => startWith(depsWithBuiltIns(injected), 'only-this-one')).not.toThrow();
  });

  it('leaves the module built-ins in place when nothing is injected', () => {
    expect(() => startWith(depsWithBuiltIns(undefined), 'general-purpose')).not.toThrow();
  });
});
