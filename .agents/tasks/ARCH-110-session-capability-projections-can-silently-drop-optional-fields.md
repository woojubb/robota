---
title: 'ARCH-110: session capability projections can silently drop optional fields'
issue: https://github.com/woojubb/robota/issues/2295
status: todo
created: 2026-08-24
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-transport-tui, packages/agent-transport, packages/agent-framework, scripts/harness
depends_on: []
---

# ARCH-110: session capability projections can silently drop optional fields

## Objective

Make the CLI presentation-to-session construction boundaries mechanically complete: a capability
accepted by the composition root must either reach `InteractiveSession` or be rejected by a
relation-level guard. Today the TUI and headless print/goal paths independently restate optional
fields across surface options, transport channel options, and hand-written projections. Conditional
object spreads can bypass excess-property checks, so callers can appear to pass a capability that an
intermediate layer silently drops.

Registered as GitHub issue #2295 after PR #2293 exposed `orgPolicy` being discarded first on the
default TUI path and then on the headless print/goal path. The same defect class previously dropped
`allowedTools`/`deniedTools`, `modelId`, and `effort` in TUI projections and `effort` in the headless
projection; the current option-reachability guard does not cover these presentation/session surfaces.

## Plan

- [ ] Establish the authoritative contract for capabilities that must cross every CLI
      presentation-to-session construction path (TUI, print/goal, and serve).
- [ ] Replace independent hand-maintained projections with one owned projection, or extend the existing
      reachability mechanism to verify the actual source-to-session relation.
- [ ] Add mutation coverage proving that deleting a required projection edge fails locally.
- [ ] Remove every `Contained — ARCH-110.` hold only after the root mechanism and affected capability
      wiring are verified.

## Completion Criteria

- [ ] Every capability declared at a CLI presentation boundary has an explicit, mechanically checked
      disposition at the `InteractiveSession` boundary.
- [ ] Mutations that remove the TUI or headless `orgPolicy` projection fail before runtime.
- [ ] The default TUI path enforces a real `blockedCommands` policy loaded from disk.
- [ ] The print/goal path enforces a real `blockedCommands` policy loaded from disk.
- [ ] Existing CLI, TUI, headless channel, and session suites remain green.

## Test Plan

- Add focused mutation or conformance tests that remove declared TUI and headless projection edges and
  prove the guard fails.
- Run the affected CLI/transport/framework package builds and tests, `pnpm typecheck`, and the
  registered harness scan that owns the relation.
- Run both CLI scenarios below through the shipped composition paths.

## User Execution Test Scenarios

### Scenario: a policy loaded from disk blocks a command in the default TUI

Prerequisites: build the CLI and use a temporary home containing `.robota/org-policy.json` with
`{"blockedCommands":["clear"]}` plus a valid provider configuration.

Steps: launch the default `robota` TUI with that temporary home and submit `/clear`.

Expected: the command is rejected by the organization-policy message; the session stays running and
the history is not cleared.

Cleanup: exit the TUI and remove the temporary home.

Evidence: pending implementation.

### Scenario: a policy loaded from disk blocks a command in print mode

Prerequisites: build the CLI and use a temporary home containing `.robota/org-policy.json` with
`{"blockedCommands":["clear"]}` plus a valid provider configuration.

Steps: run the built CLI with that temporary home and `-p "/clear"`.

Expected: the command is rejected by the organization-policy message and the process exits without
executing the blocked command.

Cleanup: remove the temporary home.

Evidence: pending implementation.
