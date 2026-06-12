---
title: 'CLI-071: TUI /exit prints "Shutting down..." but the process does not terminate (PTY smoke suspect)'
status: done
created: 2026-06-11
priority: medium
urgency: soon
area: packages/agent-transport
depends_on: []
---

# CLI-071: TUI shutdown hang after /exit (suspect)

## Problem

During 2026-06-11 PTY smoke testing (expect(1) driving the npm-installed beta.73 TUI with a
real provider configured):

1. `/exit` rendered `System: Shutting down...` but the process did not reach EOF within ~20s;
   the harness had to send Ctrl+C. After the shutdown message, a `Waiting for response...
(ESC to interrupt)` spinner appeared — UI state advanced after shutdown began.
2. Secondary observation: synthetic input at both burst speed and ~50ms/char repeatedly
   triggered bracketed-paste bundling (`[Pasted text #1 +3 lines]`), turning typed `/help` +
   Enter into a paste instead of a command. Paste detection may be too aggressive for
   automation/fast typists.

Both are suspects from a single observation method — confirmation needs the deterministic
PTY harness (product-verification L2). Graceful shutdown is an api-boundary rule concern.

## Expected Behavior

`/exit` completes shutdown and the process exits 0 within a bounded time; no UI state
transitions after shutdown starts. Paste detection thresholds tolerate fast sequential
keystrokes ending in Enter.

## Test Plan

- Reproduce under the L2 PTY harness: scripted `/exit` → assert process exit within timeout.
- Unit tests around the shutdown state machine (no new "waiting" state after shutdown).
- Input-flow tests for paste-detection thresholds.
- `pnpm --filter @robota-sdk/agent-transport test`

## User Execution Test Scenarios

- Prerequisite: configured provider; interactive terminal.
- Steps: run `robota`, type `/exit`, press Enter.
- Expected observable result: process exits promptly (shell prompt returns), exit code 0.
- Evidence: 2026-06-12 — the CLI-074 deterministic PTY harness (node-pty, per-key paced
  input against the built binary) **refutes the hang**: TC-08 sends `/exit` + Enter and the
  process exits with code 0 in ~1.25s (10s deadline), repeatably
  (`packages/agent-transport/src/tui/__tests__/pty/tui-pty.ptytest.ts`). The original
  observation was an expect(1) artifact: its burst input was bundled as a bracketed paste,
  leaving the input in a paste state rather than executing `/exit`. The paste-detection
  secondary observation is likewise explained — human-rate keys (35ms) are never bundled
  (TC-07 asserts no `[Pasted text` in the transcript); burst input being treated as paste is
  the intended paste-detection design. TC-08 now regression-locks clean shutdown.
