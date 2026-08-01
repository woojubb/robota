---
title: 'CLI-054: --dry-run flag advertised in help but completely unwired'
status: done
created: 2026-06-10
completed: 2026-06-11
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-framework
depends_on: []
---

# CLI-054: `--dry-run` flag advertised but unwired

## Problem

`--dry-run` is parsed into `IParsedCliArgs.dryRun` (`packages/agent-cli/src/utils/cli-args.ts:210`)
and advertised in `robota --help` as "Plan-only mode: show what the agent would do without
modifying files", with a usage example. Repo-wide grep shows the value is never referenced
outside `cli-args.ts`. Users who pass `--dry-run` get normal full execution including file
mutations — the opposite of what help promises. This is a trust/safety defect, not just a
missing feature.

## Expected Behavior

Decide and implement one of (spec-first, per process rules):

- Wire `--dry-run` to a real plan-only mode (e.g. deny-by-default permission policy for
  mutating tools at the SDK layer), or
- Remove the flag and help text until the SDK supports it.

Silently ignoring a safety flag is not acceptable.

## Test Plan

- If wired: unit/integration test that Write/Edit/Bash mutations are blocked under
  `--dry-run`; help text matches behavior.
- If removed: parser test that `--dry-run` is rejected as unknown; help no longer lists it.
- `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: built CLI binary; provider key configured; temp git repo. Environment already exists.
- Steps: `robota -p "create a file named hello.txt with contents hi" --dry-run` in the temp repo.
- Expected observable result: if wired — no `hello.txt` is created and the output describes the
  planned action; if removed — the CLI exits with an unknown-flag error.
- Cleanup: delete the temp repo.
- Evidence (2026-06-11): decision = wire as alias for the SDK-owned plan mode.
  `node packages/agent-cli/bin/robota.cjs --dry-run --permission-mode acceptEdits -p "hi"` →
  "--dry-run is an alias for --permission-mode plan and conflicts with --permission-mode
  acceptEdits", exit code 1. `--dry-run` alone maps to `permissionMode: 'plan'`
  (cli-args.test.ts 3 alias cases pass); help text now reads "Alias for --permission-mode plan
  (plan only, no execution)" — no silent ignore remains.
