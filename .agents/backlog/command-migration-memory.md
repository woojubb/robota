# Command Migration: `/memory`

## What

Migrate `/memory` from SDK embedded command registration into a command-module owner while preserving project memory behavior.

## Current Owner

- Execution helper: `packages/agent-sdk/src/commands/memory-command.ts`
- Registration/metadata: `packages/agent-sdk/src/commands/system-command.ts`
- Subcommands: `packages/agent-sdk/src/commands/system-command-metadata.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-memory`, consuming SDK memory common APIs.

## Migration Notes

- Preserve model-invocable policy and write safety metadata.
- Preserve subcommands: `list`, `show`, `add`, `pending`, `approve`, `reject`, `used`.
- Memory storage/approval logic should remain in the SDK/session memory subsystem or a lower-level package; the command module orchestrates through public APIs.

## Acceptance Criteria

- `/memory` is provided by an injected `ICommandModule`.
- Metadata, safety, subcommands, and execution are colocated.
- Model invocation still uses the same handler as slash invocation.

## Test Plan

- Port existing memory command tests to the command package.
- Add descriptor tests for model-invocable/write safety metadata.
- Add integration tests for add/list/pending approval flows through `session.executeCommand`.
