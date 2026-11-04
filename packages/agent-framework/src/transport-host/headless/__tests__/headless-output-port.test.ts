import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MockInstance } from 'vitest';

import { createHeadlessRunner } from '../headless-runner.js';

import type { IHeadlessOutput } from '../headless-runner.js';
import type { IExecutionResult, IGoalEvent } from '@robota-sdk/agent-interface-session';

/**
 * The headless runner owns no streams: everything it prints goes to the `output` it was given, and
 * nothing goes to the process it happens to run in.
 */

/** An output that remembers what each stream was given, in order. */
function capture(): { output: IHeadlessOutput; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    output: {
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
    },
    stdout,
    stderr,
  };
}

function sessionThatEmits(
  emit: (handlers: Map<string, Array<(...args: unknown[]) => void>>) => void,
) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return Object.assign(createTestInteractiveSession(), {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn(),
    submit: vi.fn(async () => emit(listeners)),
    setGoal: vi.fn(async () => emit(listeners)),
    executeCommand: vi.fn().mockResolvedValue(null),
    getSession: vi.fn(() => ({ getSessionId: () => 'session-7' })),
  });
}

const RESULT = {
  response: 'the answer',
  history: [],
  toolSummaries: [],
  contextState: {},
} as unknown as IExecutionResult;

let processStdout: MockInstance<typeof process.stdout.write>;
let processStderr: MockInstance<typeof process.stderr.write>;
beforeEach(() => {
  processStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  processStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  processStdout.mockRestore();
  processStderr.mockRestore();
});

describe('createHeadlessRunner output port', () => {
  it('writes a text run’s response to output.stdout and its error to output.stderr', async () => {
    const answered = capture();
    const ok = sessionThatEmits((handlers) => handlers.get('complete')?.forEach((h) => h(RESULT)));
    expect(
      await createHeadlessRunner({
        session: ok,
        output: answered.output,
        outputFormat: 'text',
      }).run('hi'),
    ).toBe(0);
    expect(answered.stdout).toEqual(['the answer\n']);

    const failed = capture();
    const broken = sessionThatEmits((handlers) =>
      handlers.get('error')?.forEach((h) => h(new Error('provider down'))),
    );
    expect(
      await createHeadlessRunner({
        session: broken,
        output: failed.output,
        outputFormat: 'text',
      }).run('hi'),
    ).toBe(1);
    expect(failed.stdout).toEqual([]);
    expect(failed.stderr.join('')).toContain('provider down');

    expect(processStdout).not.toHaveBeenCalled();
    expect(processStderr).not.toHaveBeenCalled();
  });

  it('writes a json run’s one result line to output.stdout', async () => {
    const out = capture();
    const session = sessionThatEmits((handlers) =>
      handlers.get('complete')?.forEach((h) => h(RESULT)),
    );

    await createHeadlessRunner({ session, output: out.output, outputFormat: 'json' }).run('hi');

    expect(out.stdout).toHaveLength(1);
    expect(JSON.parse(out.stdout[0]!)).toEqual({
      type: 'result',
      result: 'the answer',
      session_id: 'session-7',
      subtype: 'success',
    });
    expect(processStdout).not.toHaveBeenCalled();
  });

  it('writes stream-json events and the final result to output.stdout, each event with its own id', async () => {
    const out = capture();
    const session = sessionThatEmits((handlers) => {
      handlers.get('text_delta')?.forEach((h) => h('one'));
      handlers.get('text_delta')?.forEach((h) => h('two'));
      handlers.get('complete')?.forEach((h) => h(RESULT));
    });

    await createHeadlessRunner({ session, output: out.output, outputFormat: 'stream-json' }).run(
      'hi',
    );

    const lines = out.stdout.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line['type'])).toEqual(['stream_event', 'stream_event', 'result']);
    const ids = lines.slice(0, 2).map((line) => line['uuid']);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(processStdout).not.toHaveBeenCalled();
  });

  it('writes a goal run’s progress and a satisfied summary to stdout, an unmet one to stderr', async () => {
    const goalEvent = (stopReason: string): IGoalEvent =>
      ({
        type: 'goal_stopped',
        goal: { stopReason, iterations: 2 },
      }) as unknown as IGoalEvent;

    const met = capture();
    const satisfied = sessionThatEmits((handlers) => {
      handlers.get('complete')?.forEach((h) => h(RESULT));
      handlers.get('goal_event')?.forEach((h) => h(goalEvent('satisfied')));
    });
    expect(
      await createHeadlessRunner({
        session: satisfied,
        output: met.output,
        outputFormat: 'text',
      }).runGoal('do it'),
    ).toBe(0);
    expect(met.stdout).toEqual(['the answer\n', 'Goal satisfied after 2 iteration(s).\n']);
    expect(met.stderr).toEqual([]);

    const unmet = capture();
    const bounded = sessionThatEmits((handlers) =>
      handlers.get('goal_event')?.forEach((h) => h(goalEvent('max-iterations'))),
    );
    expect(
      await createHeadlessRunner({
        session: bounded,
        output: unmet.output,
        outputFormat: 'text',
      }).runGoal('do it'),
    ).toBe(2);
    expect(unmet.stdout).toEqual([]);
    expect(unmet.stderr.join('')).toContain('Goal stopped: max-iterations');

    expect(processStdout).not.toHaveBeenCalled();
    expect(processStderr).not.toHaveBeenCalled();
  });
});
