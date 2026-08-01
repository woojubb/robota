---
title: 'CLI-052: macOS Terminal.app CJK warning never invoked — warnIfTerminalAppOnMacOS orphaned'
status: done
created: 2026-06-10
completed: 2026-06-10
priority: medium
urgency: soon
area: packages/agent-cli
depends_on: []
---

# CLI-052: macOS Terminal.app CJK warning never invoked

## Problem

`warnIfTerminalAppOnMacOS()` in `packages/agent-cli/src/startup/terminal-check.ts:5` is
exported but never called anywhere in the repository. UX-002/CLI-029 (macOS Terminal.app CJK
crash runtime warning, completed) delivered this warning, but the call site was lost in a
later startup refactor. Users on macOS Terminal.app with Korean IME get no stability warning
even though the underlying SIGSEGV risk still exists (see CLI-062).

## Expected Behavior

During TUI startup on macOS when `TERM_PROGRAM` indicates Terminal.app, the warning is printed
before the TUI renders, per the original UX-002 scope.

## Test Plan

- Unit test: TUI startup path invokes `warnIfTerminalAppOnMacOS` (mock env
  `TERM_PROGRAM=Apple_Terminal` → warning emitted; iTerm → no warning).
- `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: macOS with Terminal.app; built CLI binary. Environment already exists.
- Steps: open Terminal.app and run `robota`.
- Expected observable result: a CJK/IME stability warning line is visible before or above the
  TUI input area. Running the same command in iTerm2 shows no warning.
- Cleanup: none.
- Evidence: with `TERM_PROGRAM=Apple_Terminal` (2026-06-10), the TUI run printed "⚠ macOS Terminal.app
  detected: CJK/IME input may be unstable." before the TUI rendered; with `TERM_PROGRAM=iTerm.app`
  no warning appeared (grep count 0). `warnIfTerminalAppOnMacOS(terminal)` now takes injected
  `ITerminalOutput` and is wired in the cli.ts TUI path; the duplicate unconditional warning in
  `bin/robota.cjs` (which fired even for diagnose/init/print runs) was removed so the warning
  appears exactly once, only where raw-mode input matters. Unit tests in
  `src/startup/__tests__/terminal-check.test.ts` (3 platform/TERM_PROGRAM cases).
