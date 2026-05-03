# Command Migration: `/permissions`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-permissions-module
- **Scope**: packages/agent-command-permissions, packages/agent-sdk, packages/agent-cli

## What

Migrate `/permissions` into a command-module owner that consumes SDK permission common APIs.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`

## Target Owner

`@robota-sdk/agent-command-permissions`

## Migration Notes

- Preserve output for permission mode and session-approved tools.
- Do not let CLI/TUI infer permission state independently.
- Keep command user-only unless a safety review changes model invocation policy.

## Acceptance Criteria

- [x] `/permissions` is provided by an injected `ICommandModule`.
- [x] Permission state is read via SDK common APIs.
- [x] Descriptor and behavior are colocated.
- [x] CLI slash routing has no `/permissions` display handler.

## Test Plan

- [x] Add command module tests for empty and non-empty session-approved tool lists.
- [x] Add descriptor tests for user-only invocation policy.
- [x] Add CLI routing tests for generic registry-owned command execution.

## Progress

### 2026-05-03

- Promoted backlog item to an active task.
- Selected a dedicated `@robota-sdk/agent-command-permissions` package instead of grouping with `/mode`, because `/permissions` is read-only reporting while `/mode` mutates trust state.
- Implemented the command module, SDK permission-state common APIs, CLI composition, docs, and coverage reporting updates.
- Verified targeted command behavior, root build, root typecheck, root test, root lint, harness scan, and whitespace diff checks.

## Decisions

- Reuse the SDK permission command common API for reading mode and session-approved tools, and add formatting helpers there so the command package does not duplicate session-state formatting.

## Blockers

- None.

## Result

Completed. `/permissions` now lives in `@robota-sdk/agent-command-permissions`, uses SDK common APIs for permission mode and session-approved tool state, and is routed by the CLI through the injected command registry instead of a CLI-owned display handler.
