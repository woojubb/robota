/**
 * GOAL-001: headless autonomous goal runner. A fake session emits goal lifecycle events; the
 * runner resolves to exit 0 when satisfied, GOAL_NOT_SATISFIED_EXIT_CODE at a bound, and 1 on error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createHeadlessRunner, GOAL_NOT_SATISFIED_EXIT_CODE } from '../headless-runner.js';

import type {
  IGoalEvent,
  IGoalState,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';

type TListener = (...args: unknown[]) => void;

function goalState(overrides: Partial<IGoalState> = {}): IGoalState {
  return {
    id: 'g1',
    objective: 'do it',
    status: 'satisfied',
    iterations: 2,
    maxIterations: 25,
    startedAt: '2026-06-27T00:00:00.000Z',
    progress: [],
    ...overrides,
  };
}

/** Minimal fake session whose setGoal drives a scripted sequence of events. */
function createFakeSession(
  script: (emit: (e: string, ...a: unknown[]) => void) => void,
): IInteractiveSession {
  const listeners = new Map<string, Set<TListener>>();
  const emit = (event: string, ...args: unknown[]): void => {
    for (const fn of listeners.get(event) ?? []) fn(...args);
  };
  return {
    on: (event: string, handler: TListener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: TListener) => listeners.get(event)?.delete(handler),
    setGoal: async () => {
      queueMicrotask(() => script(emit));
      return goalState();
    },
    getSession: () => ({ getSessionId: () => 'sess' }),
  } as unknown as IInteractiveSession;
}

const stdoutChunks: string[] = [];
const stderrChunks: string[] = [];

beforeEach(() => {
  stdoutChunks.length = 0;
  stderrChunks.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('headless runGoal', () => {
  it('exits 0 and prints turn responses when the goal is satisfied', async () => {
    const session = createFakeSession((emit) => {
      emit('complete', { response: 'did step 1' });
      emit('goal_event', {
        type: 'goal_started',
        goal: goalState({ status: 'active' }),
      } as IGoalEvent);
      emit('goal_event', {
        type: 'goal_stopped',
        goal: goalState({ stopReason: 'satisfied' }),
      } as IGoalEvent);
    });
    const code = await createHeadlessRunner({ session, outputFormat: 'text' }).runGoal('do it');
    expect(code).toBe(0);
    expect(stdoutChunks).toContain('did step 1\n');
    expect(stdoutChunks.join('')).toContain('Goal satisfied');
  });

  it('exits GOAL_NOT_SATISFIED_EXIT_CODE when stopped at a bound', async () => {
    const session = createFakeSession((emit) => {
      emit('goal_event', {
        type: 'goal_stopped',
        goal: goalState({ status: 'stopped', stopReason: 'max-iterations' }),
      } as IGoalEvent);
    });
    const code = await createHeadlessRunner({ session, outputFormat: 'text' }).runGoal('do it');
    expect(code).toBe(GOAL_NOT_SATISFIED_EXIT_CODE);
  });

  it('exits 1 on a turn error', async () => {
    const session = createFakeSession((emit) => {
      emit('error', new Error('provider exploded'));
    });
    const code = await createHeadlessRunner({ session, outputFormat: 'text' }).runGoal('do it');
    expect(code).toBe(1);
  });
});
