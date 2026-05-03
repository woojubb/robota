# Command Migration: `/background`

## What

Migrate `/background` task-control command registration into a command-module owner.

## Current Owner

- Execution helper: `packages/agent-sdk/src/commands/background-command.ts`
- Registration/metadata: `packages/agent-sdk/src/commands/system-command.ts`
- Subcommands: `packages/agent-sdk/src/commands/system-command-metadata.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-background`, consuming SDK background task common APIs.

## Migration Notes

- Preserve subcommands: `list`, `read`, `cancel`, `close`.
- Background task state remains SDK/runtime owned.
- Command module should consume background task APIs exposed by `InteractiveSession` or SDK common ports.

## Acceptance Criteria

- `/background` is provided by an injected `ICommandModule`.
- Metadata/subcommands and execution live in the command module.
- No SDK embedded command registration remains.

## Test Plan

- Port existing background command tests to command module tests.
- Add integration tests for list/read/cancel/close through `session.executeCommand`.
