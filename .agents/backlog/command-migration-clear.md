# Command Migration: `/clear`

## What

Migrate `/clear` from SDK embedded system-command logic into a command-module owner.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-clear` or a small session-management command package if grouped with `/rename`, `/resume`, and `/reset`.

## Migration Notes

- The command should consume a SDK session-history common API/port instead of reaching through `InteractiveSession.getSession()` directly from SDK embedded command code.
- Preserve behavior: clear conversation history and return `Conversation cleared.`
- Keep the command user-only unless a safety review explicitly makes it model-invocable.

## Acceptance Criteria

- `/clear` is provided by an injected `ICommandModule`.
- Command implementation does not live in SDK core.
- SDK exposes a minimal history-clear API if needed.
- CLI/TUI has no `/clear` branch.

## Test Plan

- Add command module tests for clearing history.
- Add integration tests proving session history is cleared through `session.executeCommand('clear', '')`.
