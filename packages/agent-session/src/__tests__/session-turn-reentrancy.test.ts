import { describe, expect, it, vi } from 'vitest';

import { Session } from '../session.js';
import { SessionBusyError, TurnClaim } from '../turn-claim.js';

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
 * Red-proved by restoring the unguarded claim/release — see each case for what it proves. The cases
 * that are NOT defect-provers (the release path, the failed-turn path) say so at their own
 * definitions, so a later reader does not count them as evidence they are not.
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
    // By TYPE, not by message: the SPEC promises `run()` rejects with `SessionBusyError`, and a
    // message regex would still pass if the refusal were ever wrapped in something else.
    expect((second as { error: unknown }).error).toBeInstanceOf(SessionBusyError);

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

  it('an ABORTED turn keeps the session claimed until it has actually unwound', async () => {
    // A turn is not over when it is asked to stop; it is over when it has stopped. The first draft
    // of this fix released the claim inside `abort()`, so `isRunning()` answered `false` while the
    // aborted turn was still live — and a new `run()` could interleave with it on the same history.
    // That is the RUNTIME-003 defect itself, moved behind the abort boundary; review caught it.
    const { provider, release } = blockingProvider();
    const session = makeSession(provider);

    const first = session.run('first');
    session.abort();

    // Still running: the signal has been sent, the turn has not yet finished with the session.
    expect(session.isRunning()).toBe(true);
    const duringUnwind = await outcomeWithin(session.run('second'));
    expect(duringUnwind.status).toBe('rejected');

    release();
    await first.catch(() => undefined);

    // Released by the turn that owned it — and only now is the session free.
    expect(session.isRunning()).toBe(false);
    const afterUnwind = await outcomeWithin(session.run('third'));
    expect(afterUnwind.status).toBe('resolved');
  });

  // Also not a defect-prover — it passes against the unguarded version too. It guards the
  // direction with the worst failure: a leaked claim is permanent.
  it('a turn that REJECTS releases the claim — a failed turn must not brick the session', async () => {
    // The highest-consequence direction of this change: a leaked claim is permanent. Every later
    // `run()` on that session would be refused forever, and the session would look busy while
    // nothing was running at all.
    const failing = {
      name: 'failing-provider',
      version: '1.0.0',
      chat: vi.fn(async () => {
        throw new Error('provider exploded');
      }),
      supportsTools: () => true,
      validateConfig: () => true,
    };
    const session = makeSession(failing);

    await expect(session.run('first')).rejects.toThrow(/provider exploded/);
    expect(session.isRunning()).toBe(false);

    // The same session still works.
    const next = await outcomeWithin(session.run('second'));
    expect(next.status).toBe('rejected');
    expect(String((next as { error: unknown }).error)).toMatch(/provider exploded/);
    // …refused for the PROVIDER's reason, not because a claim leaked.
    expect(String((next as { error: unknown }).error)).not.toMatch(/already running a turn/i);
  });
});

/**
 * The claim's own invariants, pinned directly rather than only through a session fixture. They are
 * three lines of logic and the cost of a mistake in them is a bricked session, so they are worth
 * stating where a reader can see them without assembling a provider.
 */
describe('TurnClaim (RUNTIME-003)', () => {
  it('refuses a second claim with a typed, identifiable error', () => {
    const claim = new TurnClaim();
    claim.claim();
    // `instanceof`, not a message regex: a consumer that has to pattern-match a string to tell
    // "busy, retry later" from a provider failure still needs its own busy flag, which is the thing
    // this change exists to remove.
    expect(() => claim.claim()).toThrow(SessionBusyError);
    expect(claim.isRunning()).toBe(true);
  });

  it('ignores a release from a turn that no longer owns the claim', () => {
    const claim = new TurnClaim();
    const first = claim.claim();
    claim.abort();
    first.abort(); // the owner's signal fires; the claim is still first's
    claim.release(first);

    const second = claim.claim();
    // The stale owner releasing late must not free the claim the new turn holds.
    claim.release(first);
    expect(claim.isRunning()).toBe(true);

    claim.release(second);
    expect(claim.isRunning()).toBe(false);
  });

  it('signals the running turn without releasing it, and is idempotent', () => {
    const claim = new TurnClaim();
    const controller = claim.claim();
    claim.abort();
    claim.abort();
    expect(controller.signal.aborted).toBe(true);
    expect(claim.isRunning()).toBe(true);
  });

  // Not a defect-prover: passes against the unguarded version too.
  it('aborts nothing when idle', () => {
    const claim = new TurnClaim();
    expect(() => claim.abort()).not.toThrow();
    expect(claim.isRunning()).toBe(false);
  });
});
