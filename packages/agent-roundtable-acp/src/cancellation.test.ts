import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeAgent, deferred } from './fake-agent';
import { executionOptions, openLease, turnOf } from './test-support';

const never = (): Promise<never> => new Promise<never>(() => {});
const settled = (promise: Promise<unknown>) =>
  promise.then(
    (resolved) => ({ resolved }),
    (rejected: unknown) => ({ rejected }),
  );

// Only the grace timer is faked: the streams between the client and the in-memory agent do not use
// timers, so a test can step the grace period exactly.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('cancellation on a host abort', () => {
  it('sends one session/cancel with the session id, however often the end is requested', async () => {
    const started = deferred();
    const fake = createFakeAgent({
      prompt: async (call) => {
        started.resolve();
        await call.cancelled;
        return { stopReason: 'cancelled' };
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const reason = new Error('the host stopped this run');
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await started.promise;
    controller.abort(reason);
    controller.abort(new Error('ignored: an abort fires once'));
    expect(await turn).toEqual({ rejected: reason });
    await fake.whenNotified('session/cancel');
    await Promise.all([lease.release(), lease.release()]);
    await lease.release();

    expect(fake.wire.filter((message) => message.method === 'session/cancel')).toEqual([
      { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'fake-session-1' } },
    ]);
    expect(fake.notifications).toHaveLength(1);
  });

  it('rejects with the abort reason without waiting out the grace period', async () => {
    const started = deferred();
    const fake = createFakeAgent({
      prompt: async () => {
        started.resolve();
        return never();
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const reason = new Error('the host stopped this run');
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await started.promise;
    controller.abort(reason);
    expect(await turn).toEqual({ rejected: reason });
    await fake.whenNotified('session/cancel');
    // The host has its answer, and the connection is still up, giving the agent its grace.
    expect(fake.closes()).toBe(0);
    await lease.release();
  });

  it('ends the connection after the agent acknowledges with a cancelled stop reason, and stays dead', async () => {
    const started = deferred();
    const fake = createFakeAgent({
      prompt: async (call) => {
        started.resolve();
        await call.cancelled;
        return { stopReason: 'cancelled' };
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const reason = new Error('the host stopped this run');
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await started.promise;
    controller.abort(reason);
    expect(await turn).toEqual({ rejected: reason });
    // No timer is advanced: the acknowledgement alone ends the wait.
    await fake.whenClosed();
    expect(fake.closes()).toBe(1);

    await expect(
      lease.session.runTurn(turnOf([], { turnId: 'turn-2' }), executionOptions()),
    ).rejects.toMatchObject({ code: 'session-dead' });
    expect(fake.prompts()).toHaveLength(1);
    await lease.release();
    expect(fake.closes()).toBe(1);
  });

  it('ends the connection when the grace period passes without an answer, and stays dead', async () => {
    const started = deferred();
    const fake = createFakeAgent({
      prompt: async () => {
        started.resolve();
        return never();
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await started.promise;
    controller.abort(new Error('the host stopped this run'));
    await turn;
    await fake.whenNotified('session/cancel');

    await vi.advanceTimersByTimeAsync(4_999);
    expect(fake.closes()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await fake.whenClosed();
    expect(fake.closes()).toBe(1);

    await expect(
      lease.session.runTurn(turnOf([], { turnId: 'turn-2' }), executionOptions()),
    ).rejects.toMatchObject({ code: 'session-dead' });
    await lease.release();
    expect(fake.closes()).toBe(1);
  });

  it('uses the configured grace period', async () => {
    const started = deferred();
    const fake = createFakeAgent({
      prompt: async () => {
        started.resolve();
        return never();
      },
    });
    const lease = await openLease(fake, { cancelGraceMs: 100 });
    const controller = new AbortController();
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await started.promise;
    controller.abort(new Error('the host stopped this run'));
    await turn;
    await fake.whenNotified('session/cancel');
    await vi.advanceTimersByTimeAsync(99);
    expect(fake.closes()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await fake.whenClosed();
    await lease.release();
  });

  it('lets release cut the grace period short and wait for the connection to end', async () => {
    const started = deferred();
    const fake = createFakeAgent({
      prompt: async () => {
        started.resolve();
        return never();
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await started.promise;
    controller.abort(new Error('the host stopped this run'));
    await turn;
    await fake.whenNotified('session/cancel');
    // No timer is advanced: a host that releases gets the connection ended at once.
    await lease.release();
    expect(fake.closes()).toBe(1);
    expect(fake.notifications).toHaveLength(1);
  });

  it('delivers no delta once the abort is seen, queued or late', async () => {
    const releaseSink = deferred();
    const started = deferred();
    const afterAbort = deferred();
    const delivered: string[] = [];
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('first');
        await call.chunk('second');
        await call.chunk('third');
        started.resolve();
        await call.cancelled;
        await call.chunk('after the cancel');
        afterAbort.resolve();
        return { stopReason: 'cancelled' };
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const turn = settled(
      lease.session.runTurn(
        turnOf(),
        executionOptions({
          signal: controller.signal,
          onDelta: async (text) => {
            delivered.push(text);
            await releaseSink.promise;
          },
        }),
      ),
    );
    await started.promise;
    // The sink holds 'first'; 'second' and 'third' are queued behind it.
    controller.abort(new Error('the host stopped this run'));
    await turn;
    await afterAbort.promise;
    releaseSink.resolve();
    await fake.whenClosed();
    expect(delivered).toEqual(['first']);
    await lease.release();
  });

  it('sends no cancel for a prompt that was already answered, and still ends the session', async () => {
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('complete reply');
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const delivering = deferred();
    const turn = settled(
      lease.session.runTurn(
        turnOf(),
        executionOptions({
          signal: controller.signal,
          onDelta: async () => {
            delivering.resolve();
            await never();
          },
        }),
      ),
    );
    await delivering.promise;
    await fake.whenAgentWrote(
      (message) => message.result !== undefined && 'stopReason' in (message.result as object),
    );
    await fake.peer()!.request('session/request_permission', {
      sessionId: 'fake-session-1',
      toolCall: { toolCallId: 'sync' },
      options: [{ optionId: 'no', name: 'No', kind: 'reject_once' }],
    });
    controller.abort(new Error('the host stopped this run'));
    await turn;
    await expect(
      lease.session.runTurn(turnOf([], { turnId: 'turn-2' }), executionOptions()),
    ).rejects.toMatchObject({ code: 'session-dead' });
    await lease.release();
    expect(fake.notifications).toEqual([]);
    expect(fake.closes()).toBe(1);
  });

  it('leaves a session alive when the signal was already aborted before the turn', async () => {
    const fake = createFakeAgent();
    const lease = await openLease(fake);
    const controller = new AbortController();
    controller.abort(new Error('too late to start'));
    await settled(lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })));
    expect(fake.notifications).toEqual([]);
    expect(await lease.session.runTurn(turnOf(), executionOptions())).toEqual({
      kind: 'yield',
    });
    await lease.release();
  });
});

describe('an agent that stops reading its input', () => {
  /** A launcher whose writes to the agent stall for good once `stall()` is called. */
  function stallable() {
    const started = deferred();
    const fake = createFakeAgent({
      prompt: async () => {
        started.resolve();
        return never();
      },
    });
    let stalled = false;
    const launcher = {
      async launch(context: { conversationId: string; participantId: string }) {
        const inner = await fake.launcher.launch(context);
        const writer = inner.toAgent.getWriter();
        return {
          toAgent: new WritableStream<Uint8Array>({
            write: (chunk) => (stalled ? never() : writer.write(chunk)),
          }),
          fromAgent: inner.fromAgent,
          close: inner.close,
        };
      },
    };
    return { fake, launcher, started, stall: () => (stalled = true) };
  }

  it('ends the connection after the grace period although the cancel was never written', async () => {
    const { fake, launcher, started, stall } = stallable();
    const lease = await openLease(fake, { launcher, cancelGraceMs: 50 });
    const controller = new AbortController();
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await started.promise;
    stall();
    controller.abort(new Error('the host stopped this run'));
    await turn;
    await vi.advanceTimersByTimeAsync(49);
    expect(fake.closes()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await fake.whenClosed();
    expect(fake.closes()).toBe(1);
    await lease.release();
  });

  it('lets release return and end the connection while the cancel is still stalled', async () => {
    const { fake, launcher, started, stall } = stallable();
    const lease = await openLease(fake, { launcher });
    const controller = new AbortController();
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await started.promise;
    stall();
    controller.abort(new Error('the host stopped this run'));
    await turn;
    // No timer is advanced: release alone must end the wait.
    await lease.release();
    expect(fake.closes()).toBe(1);
  });
});

describe('the reply bound', () => {
  const replyOf = (...chunks: string[]) =>
    createFakeAgent({
      prompt: async (call) => {
        for (const chunk of chunks) await call.chunk(chunk);
        return { stopReason: 'end_turn' };
      },
    });

  it('accepts a reply exactly at the bound and keeps the session', async () => {
    const fake = replyOf('hello', 'world');
    const lease = await openLease(fake, { maxReplyChars: 10 });
    expect(await lease.session.runTurn(turnOf(), executionOptions())).toEqual({
      kind: 'speak',
      content: 'helloworld',
    });
    expect(fake.notifications).toEqual([]);
    expect(
      await lease.session.runTurn(turnOf([], { turnId: 'turn-2' }), executionOptions()),
    ).toEqual({ kind: 'speak', content: 'helloworld' });
    expect(fake.closes()).toBe(0);
    await lease.release();
  });

  it('fails a reply one over the bound, cancels once, ends the connection and stays dead', async () => {
    const started = deferred();
    const finished = deferred();
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('hello');
        await call.chunk('world!');
        await call.chunk('and more');
        started.resolve();
        await call.cancelled;
        await call.chunk('after the cancel');
        finished.resolve();
        return { stopReason: 'cancelled' };
      },
    });
    const lease = await openLease(fake, { maxReplyChars: 10 });
    const delivered: string[] = [];
    const failure = await settled(
      lease.session.runTurn(
        turnOf(),
        executionOptions({
          onDelta: async (text) => {
            delivered.push(text);
          },
        }),
      ),
    );
    expect(failure).toMatchObject({ rejected: { code: 'reply-too-long' } });
    await finished.promise;
    await fake.whenClosed();
    // Only what fit within the bound was ever delivered; nothing beyond it, early or late.
    expect(delivered).toEqual(['hello']);
    expect(fake.wire.filter((message) => message.method === 'session/cancel')).toEqual([
      { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'fake-session-1' } },
    ]);
    await expect(
      lease.session.runTurn(turnOf([], { turnId: 'turn-2' }), executionOptions()),
    ).rejects.toMatchObject({ code: 'session-dead' });
    await lease.release();
    expect(fake.closes()).toBe(1);
  });

  it('fails at once and ends the connection after the grace period when the agent keeps going', async () => {
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('0123456789ab');
        return never();
      },
    });
    const lease = await openLease(fake, { maxReplyChars: 10 });
    const failure = await settled(lease.session.runTurn(turnOf(), executionOptions()));
    expect(failure).toMatchObject({ rejected: { code: 'reply-too-long' } });
    await fake.whenNotified('session/cancel');
    expect(fake.closes()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await fake.whenClosed();
    await lease.release();
    expect(fake.closes()).toBe(1);
  });

  it('counts the text of every chunk of the turn, not of one', async () => {
    const fake = replyOf('aaaa', 'bbbb', 'cc', 'd');
    const lease = await openLease(fake, { maxReplyChars: 10 });
    await expect(lease.session.runTurn(turnOf(), executionOptions())).rejects.toMatchObject({
      code: 'reply-too-long',
    });
    await lease.release();
  });
});
