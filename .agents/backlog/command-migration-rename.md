# Command Migration: `/rename`

## What

Migrate `/rename` into a command-module owner that requests session rename through typed command effects or SDK session APIs.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`
- Host application: CLI applies `session-renamed`

## Target Owner

Recommended: `@robota-sdk/agent-command-rename` or a session-management command package.

## Migration Notes

- Preserve usage behavior for missing name.
- Preserve typed `session-renamed` effect unless SDK session rename API is sufficient for all hosts.
- Ensure terminal title/session status update remains CLI rendering behavior.

## Acceptance Criteria

- `/rename` is provided by an injected `ICommandModule`.
- Command output/effect contract is tested.
- CLI/TUI only applies the typed effect.

## Test Plan

- Add command module tests for missing name and valid rename.
- Add CLI effect-handler test for session name state update.
