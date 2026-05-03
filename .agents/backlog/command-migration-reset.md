# Command Migration: `/reset`

## What

Migrate `/reset` into a command-module owner that requests settings reset through a typed host effect or injected settings adapter.

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
