import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  scriptedSession,
  type ScriptedSessionHarness,
} from '../../testing/scripted-session-harness.js';

/**
 * CORE-026 RUNTIME-12 — turn double-start race.
 *
 * `submit()` gates on `execCtrl.executing`, but the flag used to be set only AFTER the awaited
 * `checkAndRefreshContextIfStale` (which always awaits a context-file refresh), leaving a window where two
 * concurrent entries both observed "idle" and both started a turn. The fix claims `executing` SYNCHRONOUSLY at
 * `executePrompt` entry — before that await — so a second concurrent submit coalesces.
 *
 * To isolate exactly that window, this test MOCKS `checkAndRefreshContextIfStale` to block, fires two truly
 * concurrent submits while the first is parked at that await, and asserts the second coalesced. On the pre-fix
 * code the flag is not yet set at that point, so both submits pass the gate and double-start (pending stays 0).
 */
const refreshCtl = vi.hoisted(() => {
  return { blocking: false, release: undefined as (() => void) | undefined };
});

vi.mock('../interactive-session-context-refresh.js', () => ({
  checkAndRefreshContextIfStale: (): Promise<void> =>
    refreshCtl.blocking
      ? new Promise<void>((resolve) => {
          refreshCtl.release = resolve;
        })
      : Promise.resolve(),
}));

describe('CORE-026 RUNTIME-12 — no turn double-start', () => {
  let harness: ScriptedSessionHarness | undefined;

  afterEach(async () => {
    refreshCtl.blocking = false;
    refreshCtl.release?.();
    await harness?.dispose();
    harness = undefined;
  });

  it('a second concurrent submit coalesces instead of double-starting (race window isolated)', async () => {
    harness = scriptedSession({ turns: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] });
    const session = harness.session;

    // Warmup (refresh not yet blocking) so the session is initialized — ensureInitialized is then instant.
    await session.submit('warmup');

    // Now hold the context refresh so a turn parks at the exact check→refresh→set window.
    refreshCtl.blocking = true;

    // First submit parks at the (blocked) checkAndRefreshContextIfStale.
    const first = session.submit('one');
    for (let i = 0; i < 200 && !refreshCtl.release; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(refreshCtl.release, 'first turn should be parked at the context refresh').toBeDefined();

    // Second concurrent submit: on the FIXED code `executing` is already set (claimed synchronously at
    // executePrompt entry, before the refresh await), so this coalesces → pending 1. On the pre-fix code the
    // flag is not set until AFTER the refresh, so this would pass the gate and double-start → pending 0.
    void session.submit('two');
    for (let i = 0; i < 200 && session.getPendingCount() === 0; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(session.getPendingCount()).toBe(1);

    // Unblock and let everything drain before teardown.
    refreshCtl.blocking = false;
    refreshCtl.release?.();
    session.abort();
    await first.catch(() => undefined);
    for (let i = 0; i < 200 && (session.isExecuting() || session.getPendingCount() > 0); i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
});
