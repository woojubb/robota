# Background Workspace Projection Conformance

## Status

Backlog.

## Created

2026-05-09

## Priority

P1 - protects the background-task architecture after the CLI switcher work.

## Problem

The SDK execution workspace is the intended source of truth for main-thread, background task, and
subagent projections. The CLI should render that projection and keep only ephemeral selected-entry UI
state. Future TUI work could accidentally infer lifecycle or retention from raw runtime events.

## Recommended Direction

Run a source-backed conformance audit and add a regression guard.

Recommended audit scope:

- `agent-sdk` execution workspace APIs and `InteractiveSession` projection ownership;
- `agent-runtime` background/subagent lifecycle state machines and runner ports;
- `agent-cli` TUI components and state manager consumption of SDK snapshots;
- package specs and architecture-map references that describe background lifecycle, workspace
  entries, completed-task retention, and log/detail reads.

Recommended implementation path:

1. Verify imports and data flow from runtime to SDK to CLI.
2. Add tests or harness checks that fail if CLI starts declaring durable task lifecycle or retention
   types.
3. Update only owner package SPEC files when the audit finds drift.

## Non-Goals

- Do not redesign the background task APIs unless the audit finds a concrete contract problem.
- Do not move TUI rendering out of `agent-cli`.
- Do not duplicate runtime lifecycle contracts in CLI docs.

## Acceptance Criteria

- [ ] Source audit confirms the CLI consumes SDK execution workspace snapshots for background views.
- [ ] Any drift is fixed in the owning package, not papered over in CLI UI code.
- [ ] A mechanical guard prevents CLI-owned durable background registries or retention policies.
- [ ] Package SPEC files and architecture-map references match the audited data flow.

## Verification Plan

- `pnpm harness:scan`
- Targeted tests for SDK execution workspace and CLI background switcher behavior.
