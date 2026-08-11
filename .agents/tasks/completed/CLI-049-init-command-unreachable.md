---
title: 'CLI-049: robota init positional command unreachable — runInitCommand orphaned'
status: done
created: 2026-06-10
completed: 2026-06-10
priority: critical
urgency: now
area: packages/agent-cli
depends_on: []
---

# CLI-049: `robota init` positional command unreachable

## Problem

`runInitCommand()` exists at `packages/agent-cli/src/init/init-command.ts:74` but is never
imported or called from `cli.ts`. The only positional commands dispatched are
`session analyze` (`packages/agent-cli/src/cli.ts:85`) and `user-local`
(`packages/agent-cli/src/cli.ts:91`). The SPEC documents `robota init` as a working command,
and PM-033 (init inline provider setup) was completed against this code path, but the dispatch
was lost in a later refactor (preflight dispatcher removed in commit `a12a3348d` without a
replacement). Running `robota init` today falls through to normal TUI startup instead of
running project initialization.

## Expected Behavior

`robota init` dispatches to `runInitCommand()` before provider setup and exits with the
command result, as documented in `packages/agent-cli/docs/SPEC.md`.

## Test Plan

- Unit test: positional `init` dispatches to `runInitCommand` and does not enter TUI startup.
- Existing init-command tests still pass.
- `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: a temp directory without `.robota/` or `AGENTS.md`; built CLI binary
  (`node packages/agent-cli/bin/robota.js` or local equivalent). Environment already exists.
- Steps: run `robota init` in the temp directory.
- Expected observable result: init flow output is printed (project scaffolding/config import
  prompts), the process exits without launching the interactive TUI, and the init artifacts
  are created.
- Cleanup: delete the temp directory.
- Evidence: `node packages/agent-cli/bin/robota.cjs init --yes` in a fresh temp dir (2026-06-10) printed
  "robota project initialization" header, "Created: .robota/settings.json", "Created: AGENTS.md",
  "Initialization complete." and exited without launching the TUI (exit 0). `.robota/settings.json`
  and `AGENTS.md` verified present. Dispatch wired in `packages/agent-cli/src/cli.ts` after
  `buildCommandSetup()` with inline provider setup callback (PM-033 behavior preserved).
