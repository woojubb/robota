import { afterEach, describe, expect, it } from 'vitest';

import {
  scriptedSession,
  type ScriptedSessionHarness,
} from '../../testing/scripted-session-harness.js';

import type { TActionResponse } from '@robota-sdk/agent-core';

/**
 * CORE-026 RUNTIME-12 — turn double-start race.
 *
 * `submit()` gates on `execCtrl.executing`, but the flag used to be set only AFTER the awaited
 * `checkAndRefreshContextIfStale`, leaving a two-await window where two concurrent entries could both observe
 * "idle" and both start a turn. The fix claims `executing` SYNCHRONOUSLY at `executePrompt` entry, so a second
 * concurrent submit observes it and coalesces to the pending queue instead of double-starting.
 *
 * The first turn is held in flight deterministically by blocking on a model-issued AskUserQuestion whose
 * `askHandler` answer we release manually — so the concurrent submit reliably arrives while a turn IS executing.
 */
describe('CORE-026 RUNTIME-12 — no turn double-start', () => {
  let harness: ScriptedSessionHarness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  it('a second concurrent submit coalesces to pending instead of starting a second turn', async () => {
    let releaseAsk: ((v: TActionResponse) => void) | undefined;
    const blockedAnswer = new Promise<TActionResponse>((resolve) => {
      releaseAsk = resolve;
    });

    harness = scriptedSession({
      // The first turn asks; this handler BLOCKS until we release it, holding that turn in flight.
      askHandler: () => blockedAnswer,
      turns: [
        {
          toolCalls: [
            {
              name: 'AskUserQuestion',
              args: { questions: [{ question: 'q?', options: [{ label: 'a' }] }] },
            },
          ],
        },
        { text: 'first turn done' },
        { text: 'coalesced turn done' },
      ],
    });
    const session = harness.session;

    // Start the first turn but do NOT await — it blocks at the AskUserQuestion.
    const first = session.submit('one');

    // Wait until the first turn is executing (blocked at the ask).
    for (let i = 0; i < 200 && !session.isExecuting(); i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(session.isExecuting()).toBe(true);

    // A concurrent submit while a turn is in flight MUST coalesce to the pending queue — not double-start.
    // (submit() awaits ensureInitialized before reaching the gate, so poll until it lands in the queue; the
    // first turn stays blocked at the ask the whole time, so a coalesce is the only correct outcome.)
    void session.submit('two');
    for (let i = 0; i < 200 && session.getPendingCount() === 0; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(session.getPendingCount()).toBe(1);
    expect(session.isExecuting()).toBe(true); // still the ONE original turn — no second turn started

    // Clear the coalesced input before releasing, so the internal pending-drain re-submit cannot race the
    // afterEach dispose (which would reject "session is shutting down"). abort() also aborts the blocked first
    // turn, which we then let settle. This test asserts the COALESCE (no double-start), not the drain.
    session.abort();
    releaseAsk?.({ type: 'answer', values: ['a'] });
    await first.catch(() => undefined); // the aborted turn settles (abort is not an error to this test)
    for (let i = 0; i < 200 && (session.isExecuting() || session.getPendingCount() > 0); i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
});
