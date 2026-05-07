# Command Migration: `/clear`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-clear-module
- **Scope**: packages/agent-sdk, packages/agent-command-session, packages/agent-cli

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

- [x] `/clear` is provided by an injected `ICommandModule`.
- [x] Command implementation does not live in SDK core.
- [x] SDK exposes a minimal history-clear API if needed.
- [x] CLI/TUI has no `/clear` branch.
- [x] Interactive session history, underlying provider history, persisted session history, and TUI rendering history clear consistently.

## Test Plan

- [x] Add command module tests for clearing history.
- [x] Add integration tests proving session history is cleared through `session.executeCommand('clear', '')`.
- [x] Add CLI routing tests proving `/clear` is registry-owned.

## Progress

### 2026-05-03

- Promoted backlog to active task on `feat/command-clear-module`.
- Researched current execution paths and selected `@robota-sdk/agent-command-session` so later `/rename`, `/resume`, and `/reset` can extend the same cohesive session-command owner.
- Added SDK session command API helpers and `conversation-history-cleared` effect.
- Added `@robota-sdk/agent-command-session`, moved `/clear` execution into the package, and composed it in the CLI.
- Removed legacy CLI `/clear` semantics and SDK embedded `/clear` implementation.
- Verified with targeted package checks and full repository build/typecheck/test/lint/harness scan.

## Decisions

- Use a grouped session command package rather than a one-off clear package because the remaining session commands share command-facing session APIs and host effects.
- Add a command effect for conversation-history clearing so TUI hosts can clear rendered history without command packages importing UI code.

## Blockers

- None.

## Result

- `/clear` is now owned by `@robota-sdk/agent-command-session`.
- SDK session history and host-rendered history clear through explicit SDK command APIs/effects.
- Follow-up session command migrations can extend the same package.
