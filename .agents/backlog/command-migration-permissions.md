# Command Migration: `/permissions`

## What

Migrate `/permissions` into a command-module owner that consumes SDK permission common APIs.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-permissions`, possibly grouped with `/mode`.

## Migration Notes

- Preserve output for permission mode and session-approved tools.
- Do not let CLI/TUI infer permission state independently.
- Keep command user-only unless a safety review changes model invocation policy.

## Acceptance Criteria

- `/permissions` is provided by an injected `ICommandModule`.
- Permission state is read via SDK common APIs.
- Descriptor and behavior are colocated.

## Test Plan

- Add command module tests for empty and non-empty session-approved tool lists.
- Add descriptor tests for user-only invocation policy.
