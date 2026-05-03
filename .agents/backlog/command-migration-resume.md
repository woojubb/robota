# Command Migration: `/resume`

## What

Migrate `/resume` into a command-module owner that requests session picker behavior through typed command effects.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`
- Host application: CLI opens `SessionPicker` from `session-picker-requested`

## Target Owner

Recommended: `@robota-sdk/agent-command-resume` or a session-management command package.

## Migration Notes

- Preserve typed `session-picker-requested` effect.
- Keep picker rendering in CLI/TUI; command implementation only requests the host effect.
- Do not let slash routing branch on `/resume`.

## Acceptance Criteria

- `/resume` is provided by an injected `ICommandModule`.
- Host picker behavior is an effect handled by CLI/TUI.
- Command module has descriptor and executable handler together.

## Test Plan

- Add command module tests for `session-picker-requested`.
- Add CLI effect-handler test for opening the session picker.
