/**
 * An in-process job takes follow-up input and shows its own turns (#3679 3f, live follow).
 *
 * A job a surface follows is steered with `send`: the prompt runs as the job's next turn, after the
 * turn in flight, and the job ends only once every turn it accepted has run — so what the job
 * accepted is never dropped, and what arrives after it ended is refused, never lost silently. Its
 * log is the job's own conversation, which a surface that scrolls back reads while the job runs.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeForkedSessionRecord } from '../../interactive/interactive-session-fork-record.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { createInProcessSubagentRunner } from '../in-process-subagent-runner.js';

import type { IResolvedConfig } from '../../config/config-types.js';
import type { IAIProvider, ITerminalOutput, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ISubagentJobStart, TBackgroundTaskRunnerEvent } from '@robota-sdk/agent-executor';

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
  provider: { name: 'gated-test-provider', model: 'gated-model' },
  permissions: { allow: [], deny: [] },
  defaultTrustLevel: 'moderate',
  currentProvider: 'gated',
  env: {},
} as unknown as IResolvedConfig;

/** A provider whose every reply waits for the test to let it go, and that records what it was asked. */
function gatedProvider(): {
  provider: IAIProvider;
  /** The request texts, in order: the last user message of each call. */
  asked: string[];
  /** Lets the oldest waiting reply go with `answer`; resolves once that call has been answered. */
  answer: (answer: string) => Promise<void>;
  /** Lets the oldest waiting reply go at once, in this tick. */
  answerNow: (answer: string) => void;
  /** How many calls are waiting for an answer. */
  waiting: () => number;
} {
  const asked: string[] = [];
  const pending: Array<(text: string) => void> = [];
  const provider = {
    name: 'gated-test-provider',
    version: 'test',
    async chat(
      messages: TUniversalMessage[],
      options?: { onTextDelta?: (delta: string) => void },
    ): Promise<TUniversalMessage> {
      const last = [...messages].reverse().find((message) => message.role === 'user');
      asked.push(typeof last?.content === 'string' ? last.content : '');
      const text = await new Promise<string>((resolve) => pending.push(resolve));
      options?.onTextDelta?.(text);
      return {
        id: `gated-${asked.length}`,
        role: 'assistant',
        content: text,
        state: 'complete',
        timestamp: new Date(),
      };
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools: () => true,
    validateConfig: () => true,
  } as unknown as IAIProvider;
  return {
    provider,
    asked,
    answer: async (text) => {
      await waitFor(() => pending.length > 0);
      pending.shift()?.(text);
    },
    answerNow: (text) => {
      const resolve = pending.shift();
      if (resolve === undefined) throw new Error('no reply is waiting');
      resolve(text);
    },
    waiting: () => pending.length,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition was not reached');
}

function job(
  cwd: string,
  options: { resumeSessionId?: string; emit?: (event: TBackgroundTaskRunnerEvent) => void } = {},
): ISubagentJobStart {
  return {
    taskId: 'agent_job',
    request: {
      agentType: 'general-purpose',
      label: 'job',
      mode: 'background',
      parentSessionId: 'session_parent',
      depth: 1,
      cwd,
      prompt: 'start the work',
      permissionPolicy: 'inherit-allowlist',
      ...(options.resumeSessionId === undefined
        ? {}
        : { resumeSessionId: options.resumeSessionId }),
    },
    ...(options.emit === undefined ? {} : { emit: options.emit }),
  };
}

describe('an in-process job that takes follow-up input', () => {
  let cwd: string;
  let gated: ReturnType<typeof gatedProvider>;

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'framework-job-send-')));
    gated = gatedProvider();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function runner(store?: NodeSessionStore) {
    return createInProcessSubagentRunner({
      host: testHost,
      config: CONFIG,
      context: { agentsMd: '', projectNotesMd: '' },
      tools: [],
      terminal: NOOP_TERMINAL,
      provider: gated.provider,
      ...(store === undefined ? {} : { resumeSessionStore: store }),
    });
  }

  it('runs a prompt sent mid-turn as the next turn, and its answer is the job’s result', async () => {
    const events: TBackgroundTaskRunnerEvent[] = [];
    const handle = runner().start(job(cwd, { emit: (event) => events.push(event) }));
    await waitFor(() => gated.waiting() === 1);

    await handle.send('also do the other thing');
    expect(gated.asked).toEqual(['start the work']);

    await gated.answer('first answer');
    await gated.answer('second answer');
    const result = await handle.result;

    expect(gated.asked).toEqual(['start the work', 'also do the other thing']);
    expect(result.output).toBe('second answer');
    // The follow-up turn is as visible as the first: a surface following the job sees both.
    const deltas = events.flatMap((event) =>
      event.type === 'background_task_text_delta' ? [event.delta] : [],
    );
    expect(deltas).toEqual(['first answer', 'second answer']);
  });

  it('runs every prompt it accepted, in the order they came', async () => {
    const handle = runner().start(job(cwd));
    await waitFor(() => gated.waiting() === 1);

    await handle.send('second');
    await handle.send('third');
    await gated.answer('a1');
    await gated.answer('a2');
    await gated.answer('a3');
    const result = await handle.result;

    expect(gated.asked).toEqual(['start the work', 'second', 'third']);
    expect(result.output).toBe('a3');
  });

  it('accepts a prompt sent in the same tick the last turn is answered, and runs it', async () => {
    const handle = runner().start(job(cwd));
    await waitFor(() => gated.waiting() === 1);

    gated.answerNow('first');
    await handle.send('just in time');
    await gated.answer('second');
    const result = await handle.result;

    expect(gated.asked).toEqual(['start the work', 'just in time']);
    expect(result.output).toBe('second');
  });

  it('refuses a prompt sent after the job ended, instead of dropping it', async () => {
    const handle = runner().start(job(cwd));
    await gated.answer('done');
    await handle.result;

    await expect(handle.send('too late')).rejects.toThrow('has ended');
    expect(gated.asked).toEqual(['start the work']);
  });

  it('drops the queue on cancel and refuses what comes after', async () => {
    const handle = runner().start(job(cwd));
    await waitFor(() => gated.waiting() === 1);
    await handle.send('queued, never run');

    await handle.cancel('stop');
    await gated.answer('answer to the aborted turn');
    await handle.result.catch(() => undefined);

    expect(gated.asked).toEqual(['start the work']);
    await expect(handle.send('after the cancel')).rejects.toThrow('has ended');
  });

  describe('its log', () => {
    it('is the job’s own turns, paged by message, while the job runs', async () => {
      const handle = runner().start(job(cwd));
      await waitFor(() => gated.waiting() === 1);
      const initial = await handle.readLog?.({ offset: 0 });
      expect(initial?.lines).toEqual(['user: start the work']);
      expect(initial?.nextCursor).toBeUndefined();
      await handle.send('and then this');
      await gated.answer('did the first part');
      await waitFor(() => gated.waiting() === 1);

      const page = await handle.readLog?.();

      expect(page?.lines).toEqual([
        'user: start the work',
        'assistant: did the first part',
        'user: and then this',
      ]);
      expect(page?.nextCursor).toBeUndefined();
      expect((await handle.readLog?.({ offset: 0 }))?.lines).toEqual(page?.lines);
      const second = await handle.readLog?.({ offset: 2 });
      expect(second?.lines).toEqual(['user: and then this']);
      await gated.answer('did the rest');
      await handle.result;
    });

    it('leaves out the conversation a fork inherited, and refuses once the job ended, naming the way on', async () => {
      const sessions = join(cwd, 'sessions');
      mkdirSync(sessions, { mode: 0o700 });
      const store = new NodeSessionStore(sessions, { sealing: 'plain' });
      const forkId = writeForkedSessionRecord({
        source: {
          getHistory: () =>
            [
              {
                id: 'm1',
                role: 'user',
                content: 'INHERITED-from-the-parent',
                timestamp: new Date('2026-11-01T00:00:00.000Z'),
                state: 'complete',
              },
            ] as TUniversalMessage[],
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
      const handle = runner(store).start(job(cwd, { resumeSessionId: forkId }));
      await waitFor(() => gated.waiting() === 1);

      const running = await handle.readLog?.();
      expect(running?.lines).toEqual(['user: start the work']);

      await gated.answer('the fork answers');
      await handle.result;
      await expect(handle.readLog?.()).rejects.toThrow(
        'has ended; its conversation is saved with the forked session',
      );
    });
  });
});
