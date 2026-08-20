import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { CompactionOrchestrator } from '../compaction-orchestrator.js';

import type { IAIProvider, IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';

/**
 * RUNTIME-004 — aborting a turn during auto-compaction destroyed the conversation.
 *
 * `executeRun` compacts at the head of a turn, with the turn's `abortSignal` in scope and not passed.
 * `compact()` took no signal and called `provider.chat(…, { model })`, so the provider ran to
 * completion after the user had cancelled — and then `session-history-ops` unconditionally did
 * `clearHistory()` → re-inject system → inject `[Context Summary]`.
 *
 * So a cancel during compaction did not cancel, and did not leave things as they were: it replaced
 * the whole conversation with a summary the user had asked not to produce. History is append-only
 * source data; CORE-019 already established that a FAILED compaction must leave it untouched
 * (`compaction-failure-preservation.test.ts`). An ABORTED one is the same requirement, and the rest of
 * `agent-session` already honours cancellation — which makes this an asymmetry, not an omission.
 */
function createProvider(
  onChat: (options: IChatOptions | undefined) => void = () => undefined,
): IAIProvider {
  return {
    name: 'abort-probe',
    chat: async (_messages: TUniversalMessage[], options?: IChatOptions) => {
      onChat(options);
      return {
        id: randomUUID(),
        role: 'assistant' as const,
        content: 'a summary nobody asked for',
        state: 'complete' as const,
        timestamp: new Date(),
      };
    },
  } as IAIProvider;
}

function createHistory(): TUniversalMessage[] {
  return [
    {
      id: randomUUID(),
      role: 'user',
      content: 'important original message',
      state: 'complete' as const,
      timestamp: new Date(),
    },
  ] as TUniversalMessage[];
}

function createOrchestrator(): CompactionOrchestrator {
  return new CompactionOrchestrator({
    sessionId: 'runtime-004-test',
    cwd: '/tmp',
    model: 'test-model',
    hooks: undefined,
    hookTypeExecutors: undefined,
  });
}

describe('compaction honours the turn abort (RUNTIME-004)', () => {
  it('passes the signal through to the provider call', async () => {
    // Against the defect the provider is called with `{ model }` only, so a cancel mid-request
    // cannot reach the request that is in flight.
    const seen: Array<IChatOptions | undefined> = [];
    const controller = new AbortController();

    await createOrchestrator().compact(
      createProvider((options) => seen.push(options)),
      createHistory(),
      undefined,
      controller.signal,
    );

    expect(seen[0]?.signal).toBe(controller.signal);
  });

  it('THROWS rather than returning a summary when the signal aborted mid-call', async () => {
    // The destructive half. The caller replaces the whole history with whatever this returns, so
    // returning a summary after a cancel is what destroys the conversation. Throwing is what makes
    // the caller's existing failure path — leave history untouched — apply to a cancel too.
    const controller = new AbortController();
    const provider = createProvider(() => controller.abort());

    await expect(
      createOrchestrator().compact(provider, createHistory(), undefined, controller.signal),
    ).rejects.toThrow(/abort/i);
  });

  it('what it throws is classified as the user cancelling, not as a failed turn', async () => {
    // The doc on `compact()` says the error reaches the caller as an abort. `isAbortFailure` is the
    // repository's one owner of that decision (CORE-027), so the claim is checked against it rather
    // than asserted — a turn's own cancellation must not surface as a provider failure.
    const { isAbortFailure } = await import('@robota-sdk/agent-core');
    const controller = new AbortController();
    controller.abort();

    const error = await createOrchestrator()
      .compact(createProvider(), createHistory(), undefined, controller.signal)
      .catch((err: unknown) => err);

    expect(isAbortFailure(error)).toBe(true);
  });

  it('checks the signal even when there is nothing to summarise', async () => {
    // Review round 1. The empty-history early return came BEFORE the abort check, so the orchestrator
    // returned `''` for an already-cancelled turn — and the caller replaces history with whatever it
    // returns, so a cancel could still clear the conversation and inject an empty summary. Narrow to
    // reach (the caller filters system messages, so a system-only history takes this path) and a
    // real hole in the one invariant this change exists to establish.
    const controller = new AbortController();
    controller.abort();

    await expect(
      createOrchestrator().compact(createProvider(), [], undefined, controller.signal),
    ).rejects.toThrow(/abort/i);
  });

  it('a signal that never aborts changes nothing', async () => {
    const controller = new AbortController();
    const summary = await createOrchestrator().compact(
      createProvider(),
      createHistory(),
      undefined,
      controller.signal,
    );
    expect(summary).toBe('a summary nobody asked for');
  });

  it('is still callable with no signal at all', async () => {
    // `/compact` typed by the user has no turn to cancel; the parameter is optional and its absence
    // must not be read as "already aborted".
    const summary = await createOrchestrator().compact(createProvider(), createHistory());
    expect(summary).toBe('a summary nobody asked for');
  });

  it('does not even start when the signal is ALREADY aborted', async () => {
    // The cheapest correct behaviour, and the one a user who cancelled before the turn began
    // expects: no provider call, no cost, no summary.
    const controller = new AbortController();
    controller.abort();
    const chat = vi.fn();

    await expect(
      createOrchestrator().compact(
        createProvider(() => chat()),
        createHistory(),
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow(/abort/i);
    expect(chat).not.toHaveBeenCalled();
  });
});

/**
 * The chain, not just the leaf. `executeRun` holds the turn's signal; every hop between it and the
 * provider call had to be widened, and wiring only the leaf would have left the destructive path
 * exactly as it was.
 */
describe('the turn signal reaches compaction through the run context (RUNTIME-004)', () => {
  it('executeRun hands its abortSignal to ctx.compact', async () => {
    const { executeRun } = await import('../session-run.js');
    const controller = new AbortController();
    let received: AbortSignal | undefined;

    const ctx = {
      contextTracker: {
        updateFromHistory: () => undefined,
        shouldAutoCompact: () => true,
        getContextState: () => ({}),
      },
      agent: { getHistory: () => [] },
      aiProvider: {},
      compact: (signal?: AbortSignal) => {
        received = signal;
        // Abort here so the turn stops immediately: this case is about the handoff, and letting the
        // run continue would pull the whole provider/tool stack into it.
        controller.abort();
        return Promise.resolve();
      },
      log: () => undefined,
    } as unknown as Parameters<typeof executeRun>[2];

    await executeRun('hello', undefined, ctx, controller.signal).catch(() => undefined);

    // Against the defect this is `undefined` — the signal was in scope and simply not passed.
    expect(received).toBe(controller.signal);
  });
});
