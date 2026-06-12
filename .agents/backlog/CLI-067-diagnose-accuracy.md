---
title: 'CLI-067: diagnose reports "No API key found" despite a working configured provider; exits 0 on issues'
status: todo
created: 2026-06-11
priority: medium
urgency: soon
area: packages/agent-cli
depends_on: []
---

# CLI-067: diagnose accuracy and exit policy

## Problem

Verified 2026-06-11 (L1, npm-installed beta.73):

1. With a configured provider profile whose `apiKey: "$ENV:NAME"` resolves at session start
   (a real API call was made in the same environment), `robota diagnose` still reports
   `✗ API key: No API key found`. The check only inspects raw env var names and ignores
   `settings.json` provider profiles — diagnose disagrees with the runtime's own resolution.
2. The Settings-file check validates only the project `.robota/settings.json`; a corrupt
   user-level `~/.robota/settings.json` passes unflagged (related: CLI-069).
3. `diagnose` exits 0 even when it prints `✗ N issue(s) found`, so it cannot gate CI or
   scripts.

## Expected Behavior

The API-key check mirrors the runtime provider resolution (env vars and configured profiles
with resolvable `$ENV:` references). Both user-level and project settings files are
validated. Exit code policy is decided in SPEC (issues found → non-zero is the useful
contract) and implemented to match.

## Test Plan

- Unit tests in `diagnose-command.test.ts`: profile-with-resolvable-env → key check passes;
  corrupt user settings → flagged; issues present → documented exit code.
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: configured profile with `--api-key-env`, env var set; no bare provider env
  keys.
- Steps: `robota diagnose; echo $?`.
- Expected observable result: API key check ✓; exit code matches the documented policy.
- Evidence: (fill after implementation)
