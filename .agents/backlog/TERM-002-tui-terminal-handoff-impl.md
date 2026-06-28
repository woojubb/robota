---
title: 'TERM-002: TUI implements the terminal-handoff port (thin suspend/resume)'
status: in-progress
created: 2026-06-27
priority: high
urgency: soon
area: packages/agent-transport-tui
depends_on: [TERM-001]
---

> Implementation landed (TerminalHandoffController + App suspend gate + render/channel wiring;
> controller logic unit-tested). The real Ink raw-mode release + child TTY handoff + restore are now
> validated by an automated PTY E2E (TEST-007), which also **surfaced and fixed a real product bug**:
> the controller's empty-render suspend did not release the parent's stdin TTY handle, so a lingering
> raw-mode read both stole the child's input and starved the parent event loop — the inherited child's
> exit was never observed and `runWithTerminal` hung forever (the TUI would never resume after
> `/shell`). Fixed in `terminal-handoff-controller.ts` by explicitly dropping raw mode + pausing the
> parent stdin around the handoff (Ink re-grabs it on resume). See "Evidence" below.

# TUI implementation of the terminal-handoff port

The thin presentation-layer half of TERM-001: while the caller runs a child process with the real
TTY, the TUI must release the screen and restore it afterward.

## What

Implement the `ITerminalHandoff` contract — imported from **`@robota-sdk/agent-interface-transport`**
(NOT `agent-framework`; this is required by the `interface-imports` gate) — in `agent-transport-tui`:
`runWithTerminal(fn)` suspends Ink's control of the terminal, awaits `fn`, then restores and forces a
full redraw; `canHandoffTerminal` reflects whether stdout/stdin is an interactive TTY. The
implementation is wired into the session via the channel's existing constructor-callback injection
(the same mechanism as the "Preset execution capability"). The headless transport
(`agent-transport`) implements the contract trivially (run `fn`; `canHandoffTerminal === false` when
there is no interactive TTY).

## Implementation approach — DECIDED: manual TTY suspend/resume (no Ink `suspendTerminal`)

**Decision (2026-06-27):** implement the handoff **manually**, without using Ink 7.1.0's
`suspendTerminal()`. The TUI must not lean on that new Ink API; we own the suspend/resume directly.
Consequence: **the ink 7.0.5 → 7.1.0 upgrade is NOT part of this feature** (it can be done later as
unrelated hygiene for the 7.0.6 Windows fix).

The TUI's `runWithTerminal(fn)` must:

1. **Suspend** — stop Ink from consuming input and writing frames during the handoff, then reset the
   TTY to a child-friendly state: `setRawMode(false)`, show cursor, exit the alternate screen (if
   used), disable bracketed paste and the kitty keyboard protocol, and flush/clear Ink's current
   frame so the child starts on a clean screen.
2. Await `fn()` (the framework spawns the child with `stdio: 'inherit'`).
3. **Resume** — re-apply Ink's terminal modes (raw mode, etc.), resume input, and force a full
   redraw rather than diffing against the stale pre-handoff frame. Restore on `fn` throw as well.

### Key implementation risk to solve

Pre-7.1.0 Ink has no public "pause the render loop" hook, so the crux of this item is **pausing Ink's
rendering cleanly** while the child owns the screen. Candidate techniques to evaluate during
implementation: rendering a null/empty tree for the duration, `instance.clear()` + suspending the
reconciler, or unmount/remount with preserved state. Pick the one that restores without flicker,
leftover raw-mode, or stale frames. This is deliberately more work than Option A — accepted to keep
the TUI off the new Ink API.

## Cross-platform

This item is **cross-platform by construction**, not POSIX-scoped — it uses Node/Ink terminal
primitives, no shell. Two rules keep it portable:

- **Only undo what we (or Ink) enabled.** Restore the exact modes Ink set (raw mode, cursor,
  alternate screen, bracketed paste, kitty keyboard) rather than blasting a fixed sequence — mirror
  Ink's own restore so terminals that never had a mode (e.g. no kitty protocol) are untouched.
- **Capability/TTY gated.** If stdout/stdin is not an interactive TTY, the port reports
  `canHandoffTerminal === false` and does not attempt terminal surgery.

Windows is a later target (TERM-007): the manual sequences depend on the terminal emulator (modern
Windows Terminal supports VT; legacy conhost is weaker), but because this code only reverses what was
enabled and is TTY-gated, it does not bake in POSIX assumptions that would block a Windows pass.

## Why

Keeps the feature framework-owned while the TUI does the one thing a presentation layer should:
release and reclaim the screen on request. Headless/plain transports implement the port trivially
(no display to suspend), so they need no Ink at all.

## Test Plan

- TUI unit/integration test (ink-testing-library) asserting the port suspends and restores rendering
  around a callback, and restores even when the callback throws.
- Manual smoke: run a handoff (e.g. launch `vi`/`less` via a consumer) and confirm the TUI restores
  cleanly with no stale frame, cursor, or raw-mode artifacts.
- typecheck / lint / `pnpm harness:scan` green (incl. deps: only the TUI package may reference ink).

## User Execution Test Scenarios

Covered by the consumer items (TERM-003/004/005). This item's own evidence is the TUI test plus a
restore-after-handoff smoke (no leftover alternate-screen / raw-mode state), now automated by the
TEST-007 PTY harness.

## Evidence (2026-06-28)

- **Real bug found + fixed.** A PTY repro (`terminal-handoff-pty-e2e.test.ts` via TEST-007) showed
  `runWithTerminal` never returning after the child exited (≈30s hang). Root cause isolated: the
  parent process kept a raw-mode TTY read on stdin (empty-render suspend only unmounts Ink's React
  input hooks; it does not pause the underlying stdin handle), which stole the child's input and
  starved the parent event loop so the child's `exit` was never observed. Fix:
  `terminal-handoff-controller.ts` now `setRawMode(false)` + `stdin.pause()` before the handoff and
  relies on Ink re-grabbing stdin on resume.
- **Automated proof on a real TTY:** `src/__tests__/terminal-handoff-pty-e2e.test.ts` — under a
  pseudo-terminal, `canHandoffTerminal === true`, the inherited child receives the driver's
  keystrokes (`CHILD_GOT:[hello-from-pty]`), `runWithTerminal` returns, and the App resumes
  (`RESUMED exit=0`); full cycle ≈1.3s. Controller unit tests (`terminal-handoff-controller.test.ts`,
  4 tests) and the full TUI suite (393 tests) stay green; `pnpm harness:scan` green.
