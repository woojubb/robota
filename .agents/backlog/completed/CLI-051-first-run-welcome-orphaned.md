---
title: 'CLI-051: first-run welcome onboarding orphaned — never invoked at startup'
status: done
created: 2026-06-10
completed: 2026-06-10
priority: high
urgency: soon
area: packages/agent-cli
depends_on: []
---

# CLI-051: First-run welcome onboarding orphaned

## Problem

`isFirstRun()`, `markOnboarded()`, and `printFirstRunWelcome()` in
`packages/agent-cli/src/startup/first-run.ts` are exported but never called anywhere in the
repository (repo-wide grep confirms zero call sites). PM-023 (first-run onboarding welcome
banner, completed 2026-05-24) delivered this feature, but the invocation was lost in a later
startup refactor. The SPEC still documents the feature as working
(`packages/agent-cli/docs/SPEC.md` "First-Run Setup" section, line 1003). New users get no
welcome banner and the onboarding marker file is never created.

## Expected Behavior

On the first TUI invocation, `printFirstRunWelcome()` output is shown and `markOnboarded()`
creates the marker file, per the SPEC First-Run Setup section. Subsequent runs skip the banner.

## Test Plan

- Unit test: startup path calls `printFirstRunWelcome` + `markOnboarded` when `isFirstRun()`
  is true, and skips both when the marker exists.
- `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: remove the onboarding marker file (path per `first-run.ts`, under `~/.robota/`);
  built CLI binary. Environment already exists.
- Steps: run `robota` (TUI mode) in a terminal; quit; run `robota` again.
- Expected observable result: first run shows the welcome banner; the marker file now exists;
  second run shows no banner.
- Cleanup: none (marker file is the product state).
- Evidence: with a fresh `$HOME` and valid provider settings (2026-06-10), first `robota` TUI run printed the
  boxed "Welcome to robota!" banner before the TUI logo and created `$HOME/.robota/onboarded`;
  the second run printed no banner (`grep -c "Welcome to"` → 0). Wiring in `cli.ts` TUI path just
  before `renderApp()`; unit tests in `src/startup/__tests__/first-run.test.ts` (marker gating with
  injectable marker path + banner content).
