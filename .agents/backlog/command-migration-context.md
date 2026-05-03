# Command Migration: `/context`

## What

Migrate `/context` into a command-module owner that consumes SDK context-window common APIs.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`
- Auto compact threshold helper: `packages/agent-sdk/src/commands/system-command-metadata.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-context`, potentially grouped with compact auto-control work.

## Migration Notes

- Preserve token usage output and auto compact threshold display.
- Future auto compact controls should be exposed as command descriptors/subcommands rather than CLI-specific settings UI.
- Context percentage must come from structured SDK state, not prose parsing.

## Acceptance Criteria

- `/context` is provided by an injected `ICommandModule`.
- Context and auto compact data are exposed through SDK common APIs.
- Tests cover enabled and disabled auto compact display.

## Test Plan

- Add command module tests for context formatting.
- Add integration tests for auto compact threshold values and disabled state.
