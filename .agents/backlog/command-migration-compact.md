# Command Migration: `/compact`

## What

Migrate `/compact` from SDK embedded system-command logic into a command-module owner with explicit blocking lifecycle metadata.

## Current Owner

- Execution/lifecycle: `packages/agent-sdk/src/commands/system-command.ts`
- Session compaction implementation: `@robota-sdk/agent-sessions`

## Target Owner

Recommended: `@robota-sdk/agent-command-compact`, consuming SDK compaction/context common APIs.

## Migration Notes

- Preserve optional instruction argument behavior.
- Preserve blocking foreground behavior so TUI shows the same running/thinking process as prompt execution.
- Coordinate with existing compact auto-control backlog; manual compact and auto compact controls should share descriptor/common API concepts without duplicating policy.

## Acceptance Criteria

- `/compact` is provided by an injected `ICommandModule`.
- Lifecycle metadata declares `blocking`.
- The command consumes SDK compaction APIs, not session internals.
- Manual `/compact` visibly blocks/queues input consistently.

## Test Plan

- Add command module tests for compaction message and before/after context values.
- Add interactive-session lifecycle tests for blocking command state.
- Add TUI routing tests proving generic command lifecycle drives the status indicator.
