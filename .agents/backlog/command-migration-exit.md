# Command Migration: `/exit`

## What

Migrate `/exit` from CLI host command grouping into a command-module owner with explicit host shutdown effect.

## Current Owner

- Implementation: `packages/agent-cli/src/commands/cli-host-command-module.ts`
- Host application: CLI shutdown/exit handling

## Target Owner

Recommended: `@robota-sdk/agent-command-exit` or a session-management command package.

## Migration Notes

- Preserve typed `session-exit-requested` effect.
- Actual process exit remains host-owned.
- Keep user-only.

## Acceptance Criteria

- `/exit` is provided by a command-module owner.
- CLI/TUI only applies the typed shutdown effect.
- No slash router branch owns exit behavior.

## Test Plan

- Add command module tests for `session-exit-requested`.
- Add CLI effect-handler tests for shutdown reason and message.
