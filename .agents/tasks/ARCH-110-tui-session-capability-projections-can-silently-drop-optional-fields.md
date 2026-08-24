---
title: 'ARCH-110: TUI session capability projections can silently drop optional fields'
issue: https://github.com/woojubb/robota/issues/2295
status: todo
created: 2026-08-24
priority: medium
urgency: soon
area: packages/agent-transport-tui, packages/agent-framework, scripts/harness
depends_on: []
---

# ARCH-110: TUI session capability projections can silently drop optional fields

## Objective

Make the TUI session-construction boundary mechanically complete: a capability accepted by the
composition root must either reach `InteractiveSession` or be rejected by a relation-level guard.
Today the path independently restates optional fields in `IRenderOptions`,
`ITuiInteractionChannelOptions`, and hand-written projections. Conditional object spreads can bypass
excess-property checks, so callers can appear to pass a capability that an intermediate layer silently
drops.

Registered as GitHub issue #2295 after PR #2293 exposed `orgPolicy` being discarded on the default
TUI path. The same defect class previously dropped `allowedTools`/`deniedTools`, `modelId`, and
`effort`; the current option-reachability guard does not cover the TUI projection surfaces.

## Plan

- [ ] Establish the authoritative contract for capabilities that must cross the TUI construction path.
- [ ] Replace independent hand-maintained projections with one owned projection, or extend the existing
      reachability mechanism to verify the actual source-to-session relation.
- [ ] Add mutation coverage proving that deleting a required projection edge fails locally.
- [ ] Remove every `Contained — ARCH-110.` hold only after the root mechanism and affected capability
      wiring are verified.

## Completion Criteria

- [ ] Every capability declared at the TUI composition boundary has an explicit, mechanically checked
      disposition at the `InteractiveSession` boundary.
- [ ] A mutation that removes the `orgPolicy` projection fails before runtime.
- [ ] The default TUI path enforces a real `blockedCommands` policy loaded from disk.
- [ ] Existing TUI channel and session suites remain green.

## Test Plan

- Add a focused mutation or conformance test that removes one declared TUI projection edge and proves
  the guard fails.
- Run the affected transport/framework package builds and tests, `pnpm typecheck`, and the registered
  harness scan that owns the relation.
- Run the CLI/TUI scenario below through the shipped composition path.

## User Execution Test Scenarios

### Scenario: a policy loaded from disk blocks a command in the default TUI

Prerequisites: build the CLI and use a temporary home containing `.robota/org-policy.json` with
`{"blockedCommands":["clear"]}` plus a valid provider configuration.

Steps: launch the default `robota` TUI with that temporary home and submit `/clear`.

Expected: the command is rejected by the organization-policy message; the session stays running and
the history is not cleared.

Cleanup: exit the TUI and remove the temporary home.

Evidence: pending implementation.
