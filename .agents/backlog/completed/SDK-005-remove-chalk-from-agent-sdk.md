---
title: 'SDK-005: Remove chalk from agent-sdk'
status: done
created: 2026-05-15
priority: low
urgency: later
area: packages/agent-sdk, packages/agent-cli
---

## Problem

`agent-sdk/src/permissions/permission-prompt.ts` imports `chalk` and uses it for terminal
styling. The SDK is declared platform-neutral. `chalk` in `agent-sdk` means any environment
consuming the SDK (server, edge, WASM) gets ANSI escape sequences injected into output
regardless of whether a TTY is present.

**Evidence**:

- `agent-sdk/package.json` line 50: `"chalk": "^5.3.0"`
- `agent-sdk/src/permissions/permission-prompt.ts` lines 7, 36–37: `import chalk from 'chalk'`

**Source**: ARCH-SA-007, ARCH-SD-009 (both reviews 2026-05-15)

## Scope

1. Remove direct `chalk` usage from `permission-prompt.ts`
2. Route styled strings through `ITerminalOutput` instead — use plain string formatting,
   let the CLI adapter (`agent-transport-tui` or `agent-cli`) apply ANSI styling at render time
3. Remove `chalk` from `agent-sdk/package.json` dependencies
4. Add styled rendering in the CLI adapter layer if the visual output degrades

## Test Plan

- `chalk` absent from `agent-sdk/package.json`
- `pnpm --filter @robota-sdk/agent-sdk build` passes
- `pnpm test` passes for `agent-sdk`
- Permission prompt output is still readable in CLI (visual regression check)
- `pnpm typecheck` clean

## User Execution Test Scenarios

**Scenario**: Permission prompt renders correctly after chalk removal

Prerequisites: Full build passing

Steps:

1. Run the Robota CLI
2. Trigger a command that shows a permission prompt
3. Observe that the prompt text is readable and styled appropriately

Expected: Permission prompt renders without broken characters or missing styling.
ANSI codes are applied by the CLI adapter, not by `agent-sdk`.

Evidence: (to be filled after implementation)
