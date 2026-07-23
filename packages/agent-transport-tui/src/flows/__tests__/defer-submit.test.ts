import { describe, expect, it, vi } from 'vitest';

import {
  cancelDeferredSubmit,
  createDeferSubmitState,
  scheduleDeferredSubmit,
} from '../defer-submit.js';

/**
 * CLI-061 — the deferred-submit orchestration. The load-bearing property: at fire time the submit reads
 * `readLatest()` (the LIVE value), so a trailing IME character applied AFTER the schedule is included. The
 * pre-fix path submitted the value captured at Enter time — this test fails against that.
 */
describe('scheduleDeferredSubmit (CLI-061)', () => {
  /** A synchronous "scheduler" that captures the callback so the test fires it deterministically. */
  function manualScheduler() {
    let fired: (() => void) | undefined;
    return {
      schedule: (fn: () => void) => {
        fired = fn;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      fire: () => fired?.(),
    };
  }

  it('submits the LATEST value at fire time, not the value at schedule time (the trailing char)', () => {
    const state = createDeferSubmitState();
    const submit = vi.fn();
    const sched = manualScheduler();

    // Value at Enter/schedule time is the pre-trailing-char string...
    let live = '안녕하세';
    scheduleDeferredSubmit(state, () => live, submit, 50, sched.schedule);
    expect(submit).not.toHaveBeenCalled(); // deferred, not immediate

    // ...the trailing syllable lands during the window...
    live = '안녕하세요';
    sched.fire();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('안녕하세요'); // FULL value — fails on the pre-fix immediate submit
  });

  it('ignores a second submit while one is in flight (no double-submit), but does not touch input', () => {
    const state = createDeferSubmitState();
    const submit = vi.fn();
    const sched = manualScheduler();

    scheduleDeferredSubmit(state, () => 'a', submit, 50, sched.schedule);
    scheduleDeferredSubmit(state, () => 'a', submit, 50, sched.schedule); // second Enter within the window
    sched.fire();

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('a fresh submit is allowed after the previous one fires', () => {
    const state = createDeferSubmitState();
    const submit = vi.fn();
    const sched = manualScheduler();

    scheduleDeferredSubmit(state, () => 'a', submit, 50, sched.schedule);
    sched.fire();
    scheduleDeferredSubmit(state, () => 'b', submit, 50, sched.schedule);
    sched.fire();

    expect(submit.mock.calls).toEqual([['a'], ['b']]);
  });

  it('cancel clears a pending timer and releases the guard (no submit after unmount)', () => {
    const state = createDeferSubmitState();
    const submit = vi.fn();
    const clear = vi.fn();
    const sched = manualScheduler();

    scheduleDeferredSubmit(state, () => 'a', submit, 50, sched.schedule);
    cancelDeferredSubmit(state, clear);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(state.timer).toBeNull();
    expect(state.isSubmitting).toBe(false);
    // A new submit is possible again after cancel.
    scheduleDeferredSubmit(state, () => 'b', submit, 50, sched.schedule);
    sched.fire();
    expect(submit).toHaveBeenCalledWith('b');
  });
});
