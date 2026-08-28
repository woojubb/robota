---
title: 'CMD-007: /cost budget persists to a hardcoded .robota/budget.json with direct node:fs inside the command module, bypassing the injected settings-adapter port'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2058#issuecomment-5456241547
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-command, packages/agent-framework
depends_on: []
---

# CMD-007: budget storage bypasses the settings port

## Problem

The `/cost budget` feature hardcodes a `.robota/budget.json` path and does raw `node:fs` persistence
inside the command module, while the architecture mandates the injected `ICommandSettingsAdapter` port
for storage that varies by deployment — and the feature is absent from the package SPEC entirely.

## Evidence

- `packages/agent-command/src/session/session-command.ts:65-100` — `BUDGET_FILE = '.robota/budget.json'`,
  `readFileSync`/`writeFileSync`/`mkdirSync` directly in the module.
- Rules: `project-structure.md:112` (persistence must use the plugin/event architecture, not direct
  I/O), `:122` (storage path must be injected), `:130` (settings I/O → typed port). The port exists:
  `ICommandSettingsAdapter` (`agent-framework/src/command-api/host-adapters.ts:8-20`), wired at the
  composition root (`agent-cli/src/startup/command-setup.ts:91-96`).
- `packages/agent-command/docs/SPEC.md:106` (session row) and the Public API sections never mention the
  budget feature or its storage.

## Direction

Route budget storage through `getCommandHostAdapters()?.settings` (or a dedicated typed budget port
injected at composition) so the path is not hardcoded and I/O is injected, and document `/cost budget`
in the SPEC.

## Test Plan

- Red-first: a scripted-session test asserts a budget set via `/cost budget` is persisted through the
  injected settings adapter (a mock adapter observes the write), with no direct `fs` call from the
  module. Fails today.
- `pnpm harness:verify -- --scope packages/agent-command` green.

## User Execution Test Scenarios

**Applies** (`/cost budget` is a user-facing command).

- Prerequisites: built CLI + provider key.
- Steps: set a budget via `/cost budget <n>`, restart the CLI, run `/cost` — check the budget
  persisted; verify no `.robota/budget.json` is written outside the configured settings location.
- Expected (after fix): the budget persists via the settings store (same location as other settings).
- Expected (before fix, contrast): a hardcoded `.robota/budget.json` appears regardless of settings
  configuration.
- Cleanup: clear the budget.
- Evidence (fill in after implementation): the persisted-budget readout after restart + storage
  location.
