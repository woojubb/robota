/**
 * CLI-061 — deferred submit for the CJK-IME last-character-drop race.
 *
 * IME composition is finalized by the terminal, which writes the final composed character into the pty as its
 * OWN stdin event that arrives JUST AFTER the confirming `\r`. If we submit synchronously on Enter, the trailing
 * syllable has not yet been applied to the input state, so it is dropped (`안녕하세요` → `안녕하세`). Deferring the
 * submit a few milliseconds lets that trailing event land, after which we re-read the LATEST value and submit it.
 *
 * This is the same app-layer fix Gemini CLI applied on the same Ink (PR #4987/#7556); no framework change and
 * no upstream Ink dependency (Ink #759 stays a watch-only item).
 *
 * Injectable `schedule`/`clear` (defaulting to the real timer) keep this unit deterministically testable —
 * there is NO fake timer shipped in `src`; a test injects its own scheduler.
 */

/**
 * Defer window before a submit fires. Larger = safer against a slow/remote pty delivering the trailing event
 * late, but adds this latency to EVERY submit (including plain ASCII). 50ms matches Gemini's default — long
 * enough for a local IME finalize, short enough to feel instant. This NARROWS the race; on a very slow pty the
 * trailing event can still land after the window (residual, accepted).
 */
export const IME_SUBMIT_DEFER_MS = 50;

type TTimer = ReturnType<typeof setTimeout>;

export interface IDeferSubmitState {
  timer: TTimer | null;
  /** Gates a SECOND submit / Enter only — never the input pipeline (the trailing char must still be processed). */
  isSubmitting: boolean;
}

export function createDeferSubmitState(): IDeferSubmitState {
  return { timer: null, isSubmitting: false };
}

/**
 * Schedule a deferred submit. At fire time it reads `readLatest()` (the LIVE input value, not a value captured
 * at Enter time) and submits it. A submit already in flight is ignored (no double-submit) — but note the caller
 * MUST keep its input pipeline live during the window so `readLatest()` sees the trailing character.
 */
export function scheduleDeferredSubmit(
  state: IDeferSubmitState,
  readLatest: () => string,
  submit: (value: string) => void,
  deferMs: number = IME_SUBMIT_DEFER_MS,
  schedule: (fn: () => void, ms: number) => TTimer = setTimeout,
): void {
  if (state.isSubmitting) return; // second Enter within the window — ignore, do not double-submit
  state.isSubmitting = true;
  state.timer = schedule(() => {
    state.timer = null;
    state.isSubmitting = false;
    submit(readLatest());
  }, deferMs);
}

/** Cancel a pending deferred submit (call on unmount so no submit fires after teardown and no timer leaks). */
export function cancelDeferredSubmit(
  state: IDeferSubmitState,
  clear: (timer: TTimer) => void = clearTimeout,
): void {
  if (state.timer !== null) {
    clear(state.timer);
    state.timer = null;
  }
  state.isSubmitting = false;
}
