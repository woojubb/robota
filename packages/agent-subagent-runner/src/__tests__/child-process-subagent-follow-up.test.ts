/**
 * #3679 3f: a child-process job takes follow-up input, and says so when it cannot.
 *
 * The child is the real worker entry over a provider the test paces. A prompt sent while the initial
 * turn runs is run as the job's next turn, and the job ends only after it; a prompt that reaches a
 * worker that has begun to finish is refused, so `send` never resolves for input that was dropped.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { ChildProcessSubagentRunner } from '../index.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  ISubagentJobHandle,
  ISubagentWorktreeAdapter,
  TBackgroundTaskRunnerEvent,
} from '@robota-sdk/agent-executor';
import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';

const TEST_TIMEOUT_MS = 30_000;
const FOLLOW_WORKER = {
  execPath: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/follow-up-worker-entry.mjs', import.meta.url))],
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
const handles: ISubagentJobHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.cancel('test over').catch(() => undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface IFixtureEvent {
  chat: number;
  phase: 'start' | 'end' | 'change';
  prompt?: string;
}

function createDeps(): IInProcessSubagentRunnerDeps {
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
  };
}

/** A running job whose provider the test paces, and what to read of it. */
function startJob(environment: Record<string, string> = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'follow-up-')));
  roots.push(directory);
  let sendSettings: ((settings: Readonly<Record<string, unknown>>) => void) | undefined;
  const runner = new ChildProcessSubagentRunner(createDeps(), {
    logSealing: 'plain',
    workerEntry: FOLLOW_WORKER,
    env: { FOLLOW_FIXTURE_DIR: directory, ...environment },
    worktreeAdapter: NO_WORKTREES,
    providerDefinitions: TEST_PROVIDER_DEFINITIONS,
    watchParentSandboxSettings: (listener) => {
      sendSettings = listener;
      return () => {
        sendSettings = undefined;
      };
    },
  });
  const emitted: TBackgroundTaskRunnerEvent[] = [];
  const handle = runner.start({
    taskId: 'agent_1',
    request: {
      permissionPolicy: 'inherit-allowlist',
      agentType: 'tester',
      label: 'Tester',
      parentSessionId: 'session_parent',
      mode: 'background',
      depth: 1,
      cwd: process.cwd(),
      prompt: 'start the work',
    },
    emit: (event) => emitted.push(event),
  });
  handles.push(handle);
  const events = (): IFixtureEvent[] => {
    const path = join(directory, 'events.jsonl');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as IFixtureEvent);
  };
  return {
    handle,
    emitted,
    events,
    /** Lets provider call `number` answer. */
    release: (number: number) => writeFileSync(join(directory, `gate-${number}`), ''),
    /** Resolves once the fixture recorded `chat` `number` in `phase`. */
    reached: async (number: number, phase: 'start' | 'end' | 'change') => {
      await waitFor(() => events().some((e) => e.chat === number && e.phase === phase));
    },
    changeSettings: () => sendSettings?.({ unreadable: true }),
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition was not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('a child-process job that takes follow-up input', () => {
  it(
    'does not run accepted follow-ups after a failed sandbox update even if the active provider ignores abort',
    async () => {
      const job = startJob({ FOLLOW_FIXTURE_FAIL_SANDBOX: '1' });
      const outcome = job.handle.result.catch((error: Error) => error);
      await job.reached(1, 'start');
      await job.handle.send('must not execute');
      job.changeSettings();
      await job.reached(0, 'change');
      job.release(1);
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('fixture sandbox update failed');
      expect(String(error)).toContain('accepted follow-up');
      expect(job.events().some((event) => event.chat === 2)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
  it(
    'runs accepted input after a failed turn and reports the failure',
    async () => {
      const job = startJob({ FOLLOW_FIXTURE_FAIL_FIRST: '1' });
      const result = expect(job.handle.result).rejects.toThrow('fixture first turn failed');
      await job.reached(1, 'start');
      await job.handle.send('accepted after failure');
      job.release(1);
      await job.reached(2, 'start');
      job.release(2);
      await result;
      expect(
        job.events().find((event) => event.chat === 2 && event.phase === 'start')?.prompt,
      ).toBe('accepted after failure');
    },
    TEST_TIMEOUT_MS,
  );
  it(
    'runs a prompt sent mid-turn as the next turn, and its answer is the job’s result',
    async () => {
      const job = startJob();
      await job.reached(1, 'start');

      await job.handle.send('also do the other thing');
      job.release(1);
      await job.reached(2, 'start');
      job.release(2);
      const result = await job.handle.result;

      expect(result.output).toBe('answer-2');
      expect(job.events().find((e) => e.chat === 2 && e.phase === 'start')?.prompt).toBe(
        'also do the other thing',
      );
      // The follow-up turn is as visible to a follower as the first.
      const deltas = job.emitted.flatMap((event) =>
        event.type === 'background_task_text_delta' ? [event.delta] : [],
      );
      expect(deltas).toEqual(['answer-1', 'answer-2']);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'runs every prompt it accepted, in order',
    async () => {
      const job = startJob();
      await job.reached(1, 'start');

      await job.handle.send('second');
      await job.handle.send('third');
      job.release(1);
      await job.reached(2, 'start');
      job.release(2);
      await job.reached(3, 'start');
      job.release(3);
      const result = await job.handle.result;

      expect(result.output).toBe('answer-3');
      expect(
        job
          .events()
          .filter((e) => e.phase === 'start')
          .map((e) => e.prompt),
      ).toEqual(['start the work', 'second', 'third']);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses a prompt that reaches a worker already finishing, instead of dropping it',
    async () => {
      // The terminal result is held back: the worker has run its turns and is finishing, alive but
      // no longer taking input, when the prompt arrives.
      const job = startJob({ FOLLOW_FIXTURE_RESULT_DELAY_MS: '1500' });
      await job.reached(1, 'start');
      job.release(1);
      await job.reached(1, 'end');

      await expect(job.handle.send('too late')).rejects.toThrow('takes no more input');
      const result = await job.handle.result;

      expect(result.output).toBe('answer-1');
      expect(job.events().some((e) => e.chat === 2)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejects a prompt sent once the worker is gone',
    async () => {
      const job = startJob();
      await job.reached(1, 'start');
      job.release(1);
      await job.handle.result;
      const pid = job.handle.pid as number;
      await waitFor(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });

      await expect(job.handle.send('after the end')).rejects.toThrow();
    },
    TEST_TIMEOUT_MS,
  );
});
