---
title: 'CLI-061: Korean-IME last-character drop on Enter — FIXED (app-layer defer-submit)'
status: done
completed: 2026-07-23
created: 2026-06-10
priority: medium
urgency: soon
area: packages/agent-transport-tui
depends_on: []
---

# CLI-061: Korean IME last-character drop on Enter — DONE

## Outcome

**Fixed at the app layer — no framework migration, no upstream-Ink dependency.** The drop was a terminal
raw-mode timing race (the final IME syllable arrives as its OWN stdin event just after the confirming `\r`),
NOT an Ink bug — it is shared by every Node TUI. Gemini CLI (same Ink) fixed the identical bug the same way, so
the earlier "watch upstream Ink, do not patch locally" plan was reversed on that evidence.

Fix: at the `CjkTextInput` submit effect, defer the submit `IME_SUBMIT_DEFER_MS (50ms)` and re-read the LIVE
`stateRef.current.value` at fire time (never the Enter-captured `effect.value`); the input pipeline stays live
during the window so the trailing character is included; the guard blocks only a second submit; the timer is
cancelled on unmount.

- Spec (fully gated): `.agents/spec-docs/done/CLI-061-cjk-ime-defer-submit.md`.
- Agent-run scenario: `.agents/evals/scenarios/cli-061-cjk-defer-submit-agent-run.md`.
- Merged: PR #1269 (`b9893455f`). proposal-reviewer REVISE (6 constraints) + pr-review-reviewer (0 actionable,
  red-before-green independently reproduced) both resolved.

## Still open (separate items — NOT this drop)

- **CLI-062** — CJK input real-terminal cursor positioning disabled (Terminal.app SIGSEGV from `setCursorPosition(x, 0)`).
  Unblocked by Ink 7.1.1's `measureElement()` position coordinates + clamping cursor coordinates to screen bounds.
- **In-line pre-edit display during composition** — the terminal draws the pre-edit overlay itself and never
  hands the composing text to the app; unsolved by ANY framework (Claude Code #22732 open). Not a functional
  defect; correct cursor positioning (CLI-062) makes the native overlay appear in the right place.
- Migration off Ink was rejected — every Node TUI hits the same raw-stdin race (zero benefit, full-rewrite cost).
