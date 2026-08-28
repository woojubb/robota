---
title: 'CLI-079: the agent-cli SPEC says the default Robota CLI does not compose /mode, but the default product includes it — decide and enforce the composition intent'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2444#issuecomment-5455751920
created: 2026-08-13
priority: medium
urgency: later
area: packages/agent-cli, packages/agent-command, packages/agent-preset
depends_on: []
---

# CLI-079: /mode is composed despite the SPEC saying it is not

## Problem

The agent-cli SPEC states the default Robota CLI does not compose `/mode` (permission-mode changes
belong under `/permissions`), but nothing on the composition path removes `agent-command-mode`, so
`/mode` reaches the shipped product. Either the SPEC sentence is stale or the composition is missing a
filter.

## Evidence

- `packages/agent-cli/docs/SPEC.md:753` — "The default Robota CLI does not compose `/mode`;
  permission-mode changes belong under `/permissions`."
- `packages/agent-command/src/default/default-command-modules.ts:93` — `createModeCommandModule()` is
  in the default set; `mode/mode-command-module.ts` — `userInvocable: true`.
- `packages/agent-cli/src/startup/command-setup.ts:113-120` — only pack-supplied names (`shell`,
  `editor`) are disabled; nothing excludes `agent-command-mode`.
- `packages/agent-preset/src/presets/default.ts:9-13` — the default preset carries no module delta.
- The architecture map agrees with the CODE (`agent-cli/composition-tree.md:54`), i.e. `/mode` is
  composed.

## Direction

Decide the intent. Code-side (the SPEC's rationale points here): exclude `agent-command-mode` in
robota's profile/base set (one line in `command-setup.ts` or the profile). Doc-side: delete the SPEC
sentence and keep `/mode`. Owner's call; the current SPEC↔product mismatch is the wrong state.

## Test Plan

- If code-side: a composition test asserts `agent-command-mode` is NOT in robota's composed modules;
  `/mode` is unavailable in the default CLI.
- If doc-side: the SPEC sentence is removed and a test pins `/mode` present.
- `pnpm harness:verify -- --scope packages/agent-cli` green.

## User Execution Test Scenarios

**Applies** (`/mode` availability is user-observable).

- Prerequisites: built CLI.
- Steps: start the TUI, type `/` and check whether `/mode` is offered (and run `/mode` if present).
- Expected (after the code-side fix): `/mode` is absent; permission-mode changes go through
  `/permissions`.
- Expected (before fix / if doc-side chosen): `/mode` is present and works.
- Cleanup: none.
- Evidence (fill in after implementation): the command palette listing showing `/mode` present/absent
  per the chosen resolution.
