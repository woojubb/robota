# Command Migration: `/mode`

## What

Migrate `/mode` permission-mode display/update behavior into a command-module owner.

## Current Owner

- Metadata/execution: `packages/agent-sdk/src/commands/system-command.ts`
- Mode constants: `packages/agent-sdk/src/commands/system-command-metadata.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-mode`, consuming SDK permission-mode common APIs.

## Migration Notes

- Preserve subcommands: `plan`, `default`, `acceptEdits`, `bypassPermissions`.
- The command should use an SDK-exposed permission mode port instead of direct session internals.
- Keep user-only unless model invocation is explicitly reviewed for safety.

## Acceptance Criteria

- `/mode` is provided by an injected `ICommandModule`.
- Metadata, subcommands, validation, and execution live together.
- SDK core only exposes generic permission-mode APIs.

## Test Plan

- Add tests for current mode display, valid mode changes, and invalid mode errors.
- Add descriptor tests for all four subcommands.
