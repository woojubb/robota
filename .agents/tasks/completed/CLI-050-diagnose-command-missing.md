---
title: 'CLI-050: robota diagnose command deleted but still documented — restore'
status: done
created: 2026-06-10
completed: 2026-06-10
priority: critical
urgency: now
area: packages/agent-cli
depends_on: []
---

# CLI-050: `robota diagnose` command deleted but still documented

## Problem

`robota diagnose` was implemented in PM-024 (6 self-diagnostic checks, completed 2026-05-24)
and later improved in PM-035, but `src/startup/diagnose-command.ts` was deleted in commit
`a12a3348d` and never replaced. The SPEC still lists the file
(`packages/agent-cli/docs/SPEC.md:873`) and documents the command
(`packages/agent-cli/docs/SPEC.md:899` — "Check setup and print diagnostics"). The first-run
welcome text also recommends `robota diagnose` (`packages/agent-cli/src/startup/first-run.ts`).
Running `robota diagnose` today does nothing diagnose-related — it falls through to TUI startup.

## Expected Behavior

`robota diagnose` is restored as a provider-free positional command that runs the diagnostic
checks (Node version, settings validity, provider keys including DASHSCOPE, network reachability)
and exits with a structured report, matching the PM-024/PM-035 completed scope.

## Test Plan

- Restore or reimplement diagnose command module with unit tests for each check.
- Positional dispatch test: `robota diagnose` does not enter TUI startup.
- `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: built CLI binary; environment already exists.
- Steps: run `robota diagnose` in any project directory.
- Expected observable result: a diagnostic report is printed (Node version, settings file
  status, provider key presence, etc.) and the process exits without launching the TUI.
- Cleanup: none.
- Evidence: `node packages/agent-cli/bin/robota.cjs diagnose` in a fresh temp dir (2026-06-10) printed the
  full 6-check report — "✓ Node.js version: v24.13.0", "✓ robota version: 3.0.0-beta.73",
  "✗ API key: No API key found", "✓ Settings file: ~/.robota/settings.json (global)",
  "⚠ Terminal: macOS Terminal.app", "✓ Network (api.anthropic.com): reachable (15ms)" and summary
  "✗ 1 issue(s) found." — then exited without TUI (exit 0). Module restored at
  `packages/agent-cli/src/startup/diagnose-command.ts` with `IDiagnoseContext` + injectable network
  check; unit tests in `src/startup/__tests__/diagnose-command.test.ts`.
