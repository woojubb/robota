# Command Migration: `/mode`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-mode-module
- **Scope**: packages/agent-command-mode, packages/agent-sdk, packages/agent-cli

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

- [x] `/mode` is provided by an injected `ICommandModule`.
- [x] Metadata, subcommands, validation, and execution live together.
- [x] SDK core only exposes generic permission-mode APIs.

## Test Plan

- [x] Add tests for current mode display, valid mode changes, and invalid mode errors.
- [x] Add descriptor tests for all four subcommands.

## Progress

### 2026-05-03

- Promoted backlog item to an active task.
- Selected a dedicated `@robota-sdk/agent-command-mode` package because `/mode` is a user-visible built-in command with descriptor and execution behavior that should not remain SDK-embedded.
- Implemented SDK permission-mode command APIs, the `@robota-sdk/agent-command-mode` package, CLI composition, and SDK/CLI test updates.

## Decisions

- Use SDK permission mode common APIs instead of duplicating mode constants or letting the command module reach into CLI/TUI state.

## Blockers

- None.

## Result

`/mode` now lives in `@robota-sdk/agent-command-mode`. SDK core exposes permission-mode command-facing APIs and no longer registers `/mode` as an SDK embedded command. CLI slash routing delegates `/mode` to the injected command execution path.
