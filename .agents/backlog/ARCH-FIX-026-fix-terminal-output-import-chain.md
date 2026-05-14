---
title: 'ARCH-FIX-026: Fix ITerminalOutput/ISpinner import chain — source from agent-core'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-sdk, packages/agent-transport-tui
---

## Problem

`ITerminalOutput` and `ISpinner` are owned by `agent-core` but are imported from
`@robota-sdk/agent-sessions` by three files:

- `agent-sdk/src/types.ts` lines 13–14 (comment: "Terminal types from agent-sessions")
- `agent-sdk/src/subagents/in-process-subagent-runner.ts`
- `agent-transport-tui/src/InkTerminal.ts` line 10

This creates an undocumented indirection through `agent-sessions` and forces `agent-transport-tui`
to carry a sessions dependency solely to obtain terminal I/O types.

**Evidence**: `agent-sdk/src/types.ts` line 13–14. `agent-transport-tui/src/InkTerminal.ts`
line 10. `agent-transport-tui/package.json` includes `agent-sessions`.

**Source**: ARCH-SA-002, ARCH-SA-009 (System Architect review 2026-05-15)

## Scope

1. Update `agent-sdk/src/types.ts` — import `ITerminalOutput`, `ISpinner` from
   `@robota-sdk/agent-core`
2. Update `agent-sdk/src/subagents/in-process-subagent-runner.ts` — same redirect
3. Update `agent-transport-tui/src/InkTerminal.ts` — import from `@robota-sdk/agent-core`
4. Verify `agent-transport-tui/package.json` — remove `@robota-sdk/agent-sessions` if no other
   usage in the package
5. Add harness check: `agent-transport-tui` must not depend on `@robota-sdk/agent-sessions`

## Test Plan

- `pnpm --filter @robota-sdk/agent-sdk build` passes
- `pnpm --filter @robota-sdk/agent-transport-tui build` passes
- `pnpm typecheck` clean
- `pnpm test` passes
- Confirm `agent-sessions` is absent from `agent-transport-tui/package.json` dependencies

## User Execution Test Scenarios

**Scenario**: TUI terminal output renders correctly after import redirect

Prerequisites: Full build passing

Steps:

1. Run the Robota CLI with the TUI transport
2. Execute a command that produces terminal output (spinner, progress, text)
3. Observe that output renders correctly

Expected: No rendering regressions. No import errors.

Evidence: (to be filled after implementation)
