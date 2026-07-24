import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

const FIXTURE_WORKER = fileURLToPath(
  new URL('./fixtures/subagent-worker-fixture.mjs', import.meta.url),
);
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
    jobId: 'agent_1',
    request: {
      type: 'tester',
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
        workerPath: FIXTURE_WORKER,
        execArgv: [],
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
      });

      const handle = runner.start(createJob());
      const result = await handle.result;

      expect(handle.pid).toBeGreaterThan(0);
      expect(result).toEqual({ jobId: 'agent_1', output: 'completed:agent_1' });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'propagates the child worker token usage into the subagent result (ANALYTICS-001 P2)',
    async () => {
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerPath: FIXTURE_WORKER,
        execArgv: [],
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
        workerPath: FIXTURE_WORKER,
        execArgv: [],
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
        workerPath: FIXTURE_WORKER,
        execArgv: [],
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
        workerPath: FIXTURE_WORKER,
        execArgv: [],
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
        workerPath: FIXTURE_WORKER,
        execArgv: [],
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
          jobId: 'agent_1',
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
