import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { createSessionRunFn } from '../session-run-fn.js';

import type { IExecutionResult } from '../../interactive/types.js';
import type { IAgentRuntime } from '../../runtime/agent-runtime.js';

/**
 * SELFHOST-011 P1 — the default eval `runFn` event wiring (review CONSIDER: cover the leak/error/interrupted
 * paths). A fake `EventEmitter` session drives `complete`/`interrupted`/`error`; no live provider.
 */

function makeResult(overrides: Partial<IExecutionResult> = {}): IExecutionResult {
  return {
    response: 'done',
    history: [],
    toolSummaries: [],
    contextState: { maxTokens: 0, usedTokens: 0, usedPercentage: 0, remainingPercentage: 0 },
    ...overrides,
  };
}

/** A fake session: `submit` fires the configured terminal event on the next microtask; `shutdown` is spied. */
class FakeSession extends EventEmitter {
  readonly shutdown = vi.fn((): Promise<void> => Promise.resolve());
  readonly submit = vi.fn((_input: string): Promise<void> => {
    queueMicrotask(() => this.behavior(this));
    return Promise.resolve();
  });
  constructor(private readonly behavior: (session: FakeSession) => void) {
    super();
  }
}

/** Build a runtime whose `createSession` returns the given fake (structurally typed for the run-fn only). */
function fakeRuntime(session: FakeSession): {
  runtime: IAgentRuntime;
  createSession: ReturnType<typeof vi.fn>;
} {
  const createSession = vi.fn(() => session);
  return { runtime: { createSession } as unknown as IAgentRuntime, createSession };
}

describe('createSessionRunFn', () => {
  it('resolves to the full complete-event IExecutionResult and shuts the session down', async () => {
    const result = makeResult({ response: 'hi', toolSummaries: [{ name: 'Write', args: '{}' }] });
    const session = new FakeSession((s) => s.emit('complete', result));
    const { runtime } = fakeRuntime(session);

    const runFn = createSessionRunFn(runtime);
    const got = await runFn('do it');

    expect(got).toBe(result); // the FULL result, not just result.response
    expect(session.submit).toHaveBeenCalledWith('do it');
    expect(session.shutdown).toHaveBeenCalledOnce();
    // listeners are removed after settling (no leak of the eval wiring)
    expect(session.listenerCount('complete')).toBe(0);
    expect(session.listenerCount('interrupted')).toBe(0);
    expect(session.listenerCount('error')).toBe(0);
  });

  it('resolves an interrupted run as a scorable result', async () => {
    const result = makeResult({ response: 'partial' });
    const session = new FakeSession((s) => s.emit('interrupted', result));
    const { runtime } = fakeRuntime(session);
    await expect(createSessionRunFn(runtime)('go')).resolves.toBe(result);
    expect(session.shutdown).toHaveBeenCalledOnce();
  });

  it('rejects on an error event but still shuts the session down (finally)', async () => {
    const session = new FakeSession((s) => s.emit('error', new Error('boom')));
    const { runtime } = fakeRuntime(session);
    await expect(createSessionRunFn(runtime)('go')).rejects.toThrow('boom');
    expect(session.shutdown).toHaveBeenCalledOnce();
    expect(session.listenerCount('error')).toBe(0);
  });

  it('spawns a fresh session per case and forwards the session options', async () => {
    const result = makeResult();
    const session = new FakeSession((s) => s.emit('complete', result));
    const { runtime, createSession } = fakeRuntime(session);
    const runFn = createSessionRunFn(runtime, { permissionMode: 'default' });
    await runFn('a');
    await runFn('b');
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenNthCalledWith(1, { permissionMode: 'default' });
  });
});
