# Command Migration: `/reset`

Status: Completed
Completed: 2026-05-03

## Checklist

- [x] Research existing SDK/CLI reset execution paths.
- [x] Select the target command owner.
- [x] Add `/reset` metadata and executable command to `@robota-sdk/agent-command-reset`.
- [x] Compose the reset command module in `agent-cli`.
- [x] Remove SDK-default embedded `/reset` command behavior.
- [x] Route legacy slash executor reset handling through the injected command path.
- [x] Add command module tests for reset effect emission.
- [x] Add CLI effect-handler tests for settings deletion success and no-op paths.
- [x] Update package docs, SDK/CLI specs, project structure, and command API backlog state.

## What

Migrate `/reset` into a command-module owner that requests settings reset through a typed host effect or injected settings adapter.

## Result

`/reset` is now owned by `@robota-sdk/agent-command-reset`. The command module is user-only, emits the SDK `settings-reset-requested` effect, and does not perform concrete host file I/O. The CLI composes the module and keeps settings deletion/shutdown inside the generic command effect handler.

## Recommendation Applied

Selected a dedicated `@robota-sdk/agent-command-reset` package instead of adding the command to the session package. `/reset` is a settings/process-control command, not a session command, and the dedicated owner keeps the package boundary explicit while still using the existing typed host effect contract.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`
- Host application: CLI deletes user settings and exits

## Target Owner

Recommended: `@robota-sdk/agent-command-reset` or a session/settings command package.

## Migration Notes

- Preserve typed `settings-reset-requested` behavior.
- Concrete file deletion belongs in a host adapter unless a command module receives an injected settings adapter.
- Keep user-only for safety.

## Acceptance Criteria

- `/reset` is provided by an injected `ICommandModule`.
- Host file I/O is injected or handled by typed host effect.
- No SDK embedded reset command remains.

## Test Plan

- Add command module tests for reset effect.
- Add CLI effect-handler tests for settings deletion success, no-op, and restart/exit messaging.
