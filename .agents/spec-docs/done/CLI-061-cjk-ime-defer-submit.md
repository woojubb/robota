---
status: done
completed: 2026-07-23
type: SCREEN
tags: [tui, input, ime, cjk, korean, ink, defer-submit, capability]
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/cli-061-cjk-defer-submit-agent-run.md
---

# CLI-061: fix Korean-IME last-character drop on Enter (app-layer defer-submit)

## Problem

Typing Korean via an IME and pressing Enter drops the last in-composition syllable
(`안녕하세요` → `안녕하세`). Root cause is a **terminal raw-mode timing race**, NOT an Ink rendering bug: IME
composition is finalized by the terminal emulator, which writes the final composed character into the pty as
its OWN stdin `data` event that arrives **just after** the confirming `\r`. Our input handler
(`CjkTextInput` → `useCjkTextInputHandlers` → `applyCjkTextInput`) processes the Enter event and calls
`onSubmit(stateRef.current.value)` **before** that trailing character's stdin event is applied to
`stateRef` — so the submitted value is short one syllable.

This is the reported, high-impact defect (it corrupts nearly every Korean prompt). It is distinct from the
cursor-positioning SIGSEGV (CLI-062) and from the "pre-edit invisible during composition" display limitation
(unsolved by any framework; not addressed here).

## Prior Art Research

**The identical bug was fixed, in a sibling CLI built on the same Ink, at the app/input layer — no framework
migration and no upstream Ink change.**

- **Ink #759** — "Input Lag, Characters Drop … IME(CJK)" — OPEN since 2025-08 (upstream will not fix it soon):
  https://github.com/vadimdemedes/ink/issues/759
- **Gemini CLI PR #4987** — "Defer submission to fix IME input bug": on Enter, `setTimeout(~50ms)` before the
  actual submit so the IME finalizes the last character into the buffer, then read the **latest** buffer via a
  `useRef` (not the stale closure) and submit; lock input during the delay (`isSubmittingRef`), `try/finally`
  release, clear timers on unmount. https://github.com/google-gemini/gemini-cli/pull/4987
- **Gemini CLI PR #7556** — unifies it into a single `deferAndSubmit` (one Enter press, not two):
  https://github.com/google-gemini/gemini-cli/pull/7556
- **Gemini CLI PR #7926** — raise Node readline `escapeCodeTimeout` 0 → ~20ms for backspace-during-composition:
  https://github.com/google-gemini/gemini-cli/pull/7926
- Cross-framework confirmation it is a terminal-layer race, not Ink-specific: **Codex #23440** (Rust/ratatui),
  **xterm.js #5887**, **VSCode #267568**; Node TTY raw-mode carries no composition boundaries
  (https://nodejs.org/api/tty.html).

Recommendation adopted: **stay on Ink; apply the defer-submit fix.** Migrating TUI frameworks would be a full
rewrite with ZERO benefit — every Node TUI reads raw stdin identically and hits the same race.

## Decision

Seam + direction confirmed at GATE-APPROVAL (proposal-reviewer traced the race end-to-end); six constraints are
BINDING for IMPLEMENT:

1. **Defer at the CjkTextInput submit EFFECT and re-read the authoritative value.** The pure reducer
   (`cjk-text-input-flow.ts:118-120`) returns `{ type: 'submit', value: state.value }` — the value CAPTURED at
   Enter time. `applyCjkTextInputEffect` (`CjkTextInput.tsx`) currently calls `onSubmit(effect.value)`
   synchronously. Instead, in that `submit` branch, schedule the submit after `IME_SUBMIT_DEFER_MS` and, at
   timer-fire, call `onSubmit(stateRef.current.value)` — **the live `stateRef`, NEVER the stale `effect.value`**.
   `stateRef` is the synchronous source of truth (do NOT read the parent's lifted `value` React state, which
   lags via `onChange`→`setValue`).
2. **Seam = CjkTextInput, not InputArea.** Deferring in `InputArea.handleSubmit` would read a lagged value and
   an InputArea `valueRef` mirror would duplicate state `stateRef` already owns (SSOT violation) and collide
   with `handleSubmit`'s eager `setValue('')`/paste reset. The fix is co-located with the synchronous state that
   owns it.
3. **CRITICAL — the guard gates ONLY the submit / a second `return`; the input pipeline STAYS LIVE during the
   window.** The trailing IME character IS an input event that arrives DURING the defer window — that is exactly
   what we are waiting for. A naive port of Gemini's "lock the whole handler while submitting" would reject the
   trailing char and **reproduce the bug**. So: `isSubmitting` blocks a second submit/Enter only; `useInput` /
   `usePaste` keep processing and keep mutating `stateRef` throughout the window.
4. **Clearing via the existing path; timer cleanup on unmount.** The deferred `onSubmit(finalValue)` →
   `InputArea.handleSubmit` → `setValue('')` → `syncCjkTextInputFlowState` clears `stateRef` naturally AFTER the
   read — do not pre-clear (`enterSelectCommand`/`handleSubmit` `setValue('')` must not fire before the deferred
   read). Add a `useEffect` unmount cleanup that clears any pending timer (no submit after unmount).
5. **`IME_SUBMIT_DEFER_MS = 50` is a named constant with a stated tradeoff, not a magic number.** Larger = safer
   but adds perceptible latency to EVERY submit (incl. plain ASCII); 50 ms matches Gemini's default. Allow a
   bounded override. Acknowledge the residual race: on a slow/remote pty the trailing event can land AFTER the
   window — the fix NARROWS the race, it does not fully close it.
6. **No-fallback:** the deferred timer must submit deterministically; a fire that reads an unexpectedly-empty
   `stateRef` still submits (or is covered by the submit guard) — never caught-and-dropped (keep
   `scan-no-fallback` green without a new suppression; the existing blessed `allow-fallback` in
   `applyCjkFlowSafely` is untouched).

Out of scope: the cursor-positioning SIGSEGV (CLI-062) and the in-line pre-edit display.

## Test Plan

- **Extract the defer orchestration into an injectable-scheduler unit** — `(readLatest: () => string, submit,
schedule)` with `schedule` defaulting to real `setTimeout` (test-only injection; no fake timer shipped in
  `src`, per no-fake-in-src). Test it at the HANDLER layer, NOT the pure reducer — a reducer-only test asserts
  the synchronous captured value (`cjk-text-input-flow.test.ts:31-39`) and would be **accidental-green**.
- **Deterministic red-before-green (fake timers):** feed jamo `change`s → `return`/submit → advance the timer
  PARTIALLY → feed the trailing composed-char `change` → advance past `DEFER_MS` → assert `onSubmit` fired
  **once** with the COMPLETE value (`안녕하세요`). On the pre-fix synchronous path the submit fires before the
  trailing event → the full-value assertion FAILS (proven red against the pre-fix code).
- **Regression:** plain ASCII + Enter submits once with full text; a double Enter in the window does not
  double-submit; the input pipeline stays live (a keystroke during the window is captured); unmount during the
  window leaks no timer and does not submit.
- `pnpm --filter @robota-sdk/agent-transport-tui build && test`.

## User Execution Test Scenarios

- **agent-executable (PRIMARY — pty replay, not owner-manual).** This package already ships `spawnPtyFixture`
  (`@robota-sdk/agent-testing`, used by `command-handoff-pty-e2e.test.ts` / `terminal-handoff-pty-e2e.test.ts`).
  Render the real `InputArea` in a pty fixture, `write('\r')`, then after a real delay `write(<trailing UTF-8
bytes of the final syllable>)`, and assert the submitted message contains the FULL syllable — reproducing the
  actual byte-ordering race headlessly (the agent runs it; the owner does NOT run a terminal smoke, per the
  agent-run capability rule).
- **Manual confirmation (OPTIONAL, not the gate):** macOS/iTerm2 + Korean IME — type `안녕하세요`, Enter while
  the last syllable composes → submitted message shows the full `안녕하세요`.
- Evidence: `.agents/evals/scenarios/cli-061-cjk-defer-submit-agent-run.md` (record the pty-replay run).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-23

- Prior Art Research: substantiated (Gemini CLI defer-submit PRs #4987/#7556/#7926 on the same Ink; Ink #759;
  cross-framework confirmation) → scan-spec-research green.
- Frontmatter (status/type SCREEN/tags + capability keys): present.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-23

Independent `proposal-reviewer`: **REVISE → resolved**. Traced the race end-to-end and ENDORSED the direction +
seam (CjkTextInput, not InputArea); REVISE'd six binding constraints, ALL applied to the Decision/Test Plan/UX:

1. Defer at the `submit` effect; re-read `stateRef.current.value`, never the stale `effect.value`.
2. Seam = CjkTextInput (SSOT — reject the InputArea `valueRef` mirror).
3. **The guard gates ONLY submit/second-Enter — the input pipeline stays LIVE** (the trailing char is an input
   event during the window; locking the handler like Gemini's naive port would reproduce the bug).
4. Clear via the existing `onSubmit→handleSubmit→setValue('')` path (after the read, no pre-clear) + `useEffect`
   unmount timer cleanup.
5. `IME_SUBMIT_DEFER_MS = 50` named + tradeoff comment + bounded override; residual slow-pty race acknowledged.
6. No-fallback: deterministic submit, no caught-and-dropped.

Test: extract an injectable-scheduler unit + fake-timers red-before-green at the HANDLER layer (a reducer test
would be accidental-green). Agent-run: `spawnPtyFixture` pty replay (write `\r` then delayed trailing UTF-8
bytes), NOT owner-manual macOS. Owner directive ("진행시켜") = GATE-APPROVAL sign-off; REVISE resolved.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-23

- `flows/defer-submit.ts` — injectable-scheduler unit (`IME_SUBMIT_DEFER_MS = 50` with tradeoff comment;
  `scheduleDeferredSubmit` reads `readLatest()` at fire time and guards a second submit only;
  `cancelDeferredSubmit`).
- `CjkTextInput.tsx` — the `submit` effect now `scheduleDeferredSubmit(deferState, () =>
stateRef.current.value, onSubmit)` (re-reads the LIVE value, never `effect.value`); `useEffect` unmount
  cancel; the `useInput`/`usePaste` pipeline stays live during the window (guard blocks only a 2nd submit).
- Seam = CjkTextInput (SSOT); InputArea's `setValue('')` clears via the existing post-submit path (no pre-clear).

### [GATE-VERIFY] — ✅ PASS | 2026-07-23

- 4 unit tests (defer orchestration) + 2 integration tests (real `CjkTextInput` via ink-testing-library:
  `안녕하세 + Enter + 요 → 안녕하세요`; no double-submit) + full agent-transport-tui suite **426 pass**, no regression.
- **Red-before-green proven:** temporarily reverting the fix (synchronous submit of `effect.value`) makes the
  integration test FAIL exactly as the bug (`onSubmit('안녕하세')` immediately + double-submit); restoring turns
  it green.
- typecheck green; 62/62 scans (no-fallback, no-fake-in-src green). Agent-run scenario:
  `.agents/evals/scenarios/cli-061-cjk-defer-submit-agent-run.md`.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-23

Merged to develop (PR #1269, squash `b9893455f`) + NIT fix (`b40fb36a2`). `pr-review-reviewer` (HARNESS-018):
**0 actionable** — independently reproduced red-before-green in a worktree (reverting the submit branch makes
both integration tests fail exactly as the bug; the fix turns them green), confirmed the guard gates only a
second submit (input pipeline live), the deferred read is `stateRef.current.value` not `effect.value`, and no
regression (426/426). NIT (over-claiming unit test name) fixed; CONSIDER (post-Enter keystrokes within the
window bleed — accepted tradeoff, matches Gemini) left as documented. Spec → `done/`. Backlog item
`CLI-061-ime-last-character-drop.md` reconciled from watch-only → done (drop fixed) and archived to `completed/`.
