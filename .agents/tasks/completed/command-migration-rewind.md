# Command Migration: `/rewind`

Status: Completed
Completed: 2026-05-03
Branch: `feat/command-rewind-module`

## What

Migrate `/rewind` edit-checkpoint command registration into a command-module owner.

## Current Owner

- Execution helper: `packages/agent-sdk/src/commands/rewind-command.ts`
- Registration/metadata: `packages/agent-sdk/src/commands/system-command.ts`
- Subcommands: `packages/agent-sdk/src/commands/system-command-metadata.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-rewind`, consuming SDK edit-checkpoint APIs.

## Migration Notes

- Preserve subcommands: `list`, `restore`, `code`, `rollback`.
- Preserve write safety metadata.
- SDK may own checkpoint store/common APIs; command module should not live inside SDK core.

## Acceptance Criteria

- `/rewind` is provided by an injected `ICommandModule`.
- Checkpoint APIs are exposed as SDK common APIs or lower-level ports.
- CLI/TUI only renders command output and later optional picker chrome.

## Test Plan

- Port existing rewind tests to command module tests.
- Add restore/rollback integration tests through `session.executeCommand`.

## Completion Notes

- Added `@robota-sdk/agent-command-rewind` as the command-module owner for `/rewind`.
- Added SDK checkpoint command common APIs under `packages/agent-sdk/src/command-api/checkpoint/`.
- Removed SDK-embedded `/rewind` execution and metadata from `packages/agent-sdk/src/commands/`.
- Composed `createRewindCommandModule()` in the CLI product entrypoint.
- Ported list, restore, code-alias, rollback, usage, and error tests into the command package.
