---
title: 'SDK-007: Add error boundary in SystemCommandExecutor'
status: backlog
created: 2026-05-15
priority: low
urgency: later
area: packages/agent-sdk
---

## Problem

`agent-sdk/src/commands/system-command-executor.ts` dispatches to command handlers without
a top-level try/catch. An unhandled error in any command handler propagates out of
`executeCommand` and can crash the active session rather than returning a structured error result.

**Evidence**: `agent-sdk/src/commands/system-command-executor.ts`: no try/catch wrapping the
handler dispatch call path.

**Source**: ARCH-SD-012 (Senior Developer review 2026-05-15)

## Scope

1. Wrap the command handler dispatch in `executeCommand` with a try/catch that catches `Error`
2. On catch: return a structured `CommandResult` with `success: false` and the error message
3. Log the stack trace via `ITerminalOutput` for diagnostics (debug level)
4. Add a unit test verifying that a handler that throws returns a structured error result
   rather than propagating the exception

## Test Plan

- `pnpm --filter @robota-sdk/agent-sdk build` passes
- Unit test added: `system-command-executor.test.ts` verifies throwing handler → structured error
- `pnpm test` passes
- `pnpm typecheck` clean
- Session does not crash when a command handler throws an unexpected error

## User Execution Test Scenarios

**Scenario**: Session survives a command handler error

Prerequisites: Full build passing. A way to trigger a command handler that throws.

Steps:

1. Run the Robota CLI
2. Trigger a command that produces an internal error (or use a test stub)
3. Observe that the session remains active and the error is surfaced as a message

Expected: Session stays alive. Error is displayed as a structured error message, not a crash.

Evidence: (to be filled after implementation)
