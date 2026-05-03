# Command Migration: `/rewind`

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
