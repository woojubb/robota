import { describe, expect, it, vi } from 'vitest';

import { Session } from '../session.js';

/**
 * RUNTIME-003 — a session had no turn identity, so a second concurrent `run()` ORPHANED the first.
 *
 * `run()` overwrote `this.abortController` unconditionally, and everything follows from that one
 * line: `abort()` cancelled only whichever turn owned the field, the first turn to finish cleared it
 * in its `finally` so `abort()` on the survivor became a silent no-op, and `isRunning()` — reading
 * the same field — answered about whichever turn happened to hold it. That is why consumers grew
 * their own busy flags instead of trusting it.
 *
 * WHAT THESE TESTS HAD TO GET RIGHT, because the first draft did not:
 *
 * - Three of four cases used a SECOND session, so they exercised nothing about a shared claim and
 *   passed against the defect. Every case here uses ONE session; that is the whole subject.
 * - The one real case failed by TIMEOUT rather than by assertion, because against the defect the
 *   second `run()` does not reject — it proceeds and blocks. A timeout is an accidental red: raise
 *   the limit and the signal disappears. The refusal case now RACES the call against a short timer
 *   and asserts on the OUTCOME, so the failure has a message.
 *
 * Red-proved by restoring the unguarded overwrite: the two defect cases fail on named assertions
 * (`expected 'pending' to be 'rejected'`, `expected false to be true`) in 262ms and 13ms. The third
 * is a regression guard and says so at its own definition.
 */
const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn().mockResolvedValue(''),
  select: vi.fn().mockResolvedValue(0),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
};

/**
 * A provider whose reply is HELD OPEN until the test releases it. A turn that resolves immediately
 * cannot demonstrate anything about concurrency — the second `run()` would simply start after the
 * first finished. Holding the first turn open is what puts two in flight at once.
 */
function blockingProvider() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  return {
    release,
    callCount: () => calls,
    provider: {
      name: 'blocking-provider',
      version: '1.0.0',
      chat: vi.fn(async () => {
        calls += 1;
        await held;
        return { role: 'assistant', content: 'done', timestamp: new Date() };
      }),
      supportsTools: () => true,
      validateConfig: () => true,
    },
  };
}

function makeSession(provider: unknown) {
  return new Session({
    tools: [] as never,
    provider: provider as never,
    systemMessage: 'test',
    terminal: MOCK_TERMINAL,
  });
}

/** Settle the promise or report that it did not — never hang the suite to make a point. */
async function outcomeWithin<T>(
  promise: Promise<T>,
  ms = 250,
): Promise<
  { status: 'resolved'; value: T } | { status: 'rejected'; error: unknown } | { status: 'pending' }
> {
  let timer: ReturnType<typeof setTimeout>;
  const pending = new Promise<{ status: 'pending' }>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'pending' }), ms);
  });
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ status: 'resolved' as const, value }),
        (error) => ({ status: 'rejected' as const, error }),
      ),
      pending,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

describe('a session runs one turn at a time (RUNTIME-003)', () => {
  it('REFUSES a second concurrent turn instead of starting it alongside the first', async () => {
    const { provider, release, callCount } = blockingProvider();
    const session = makeSession(provider);

    const first = session.run('first');
    // The claim is taken synchronously, so this holds without awaiting anything.
    expect(session.isRunning()).toBe(true);

    const second = await outcomeWithin(session.run('second'));
    // Against the defect this is `'pending'` — the second turn started and blocked on the provider.
    expect(second.status).toBe('rejected');
    expect(String((second as { error: unknown }).error)).toMatch(/already running a turn/i);

    release();
    await expect(first).resolves.toBe('done');
    expect(session.isRunning()).toBe(false);

    // Counted AFTER the first turn completes, not while it is still starting: `run()` does async
    // work before it reaches the provider, so an earlier assertion would race the first call rather
    // than measure the second. One call means the refused turn never got there.
    expect(callCount()).toBe(1);
  });

  // NOT a defect-prover, and labelled so no one later mistakes it for one: this case PASSES against
  // the unguarded overwrite too. It guards the other direction — that the claim added above is
  // released by the turn that owned it, so a session is not left permanently refusing.
  it('the SAME session accepts the next turn once the first resolves', async () => {
    const { provider, release } = blockingProvider();
    const session = makeSession(provider);

    const first = session.run('first');
    release();
    await expect(first).resolves.toBe('done');
    expect(session.isRunning()).toBe(false);

    // The claim was released by the turn that owned it, so the same session runs again.
    const second = await outcomeWithin(session.run('second'));
    expect(second.status).toBe('resolved');
  });

  it('a turn that finishes AFTER an abort does not release the next turn’s claim', async () => {
    // The defect's second half: `finally` cleared the field unconditionally, so a turn finishing
    // late released a claim a newer turn already held — and `isRunning()` then said "idle" while a
    // turn was in flight.
    const { provider: firstProvider, release: releaseFirst } = blockingProvider();
    const session = makeSession(firstProvider);

    const first = session.run('first');
    session.abort();
    expect(session.isRunning()).toBe(false);

    // A new turn claims the SAME session while the aborted one is still unwinding.
    const { release: releaseSecond } = blockingProvider();
    const second = session.run('second');
    expect(session.isRunning()).toBe(true);

    // Now let the FIRST turn finish. Its `finally` must not touch the claim the second turn holds.
    releaseFirst();
    await first.catch(() => undefined);
    expect(session.isRunning()).toBe(true);

    releaseSecond();
    session.abort();
    await second.catch(() => undefined);
  });
});
