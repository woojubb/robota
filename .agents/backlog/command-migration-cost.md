# Command Migration: `/cost`

## What

Migrate `/cost` session information display into a command-module owner.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-cost` or a session-info command package if grouped with `/context`.

## Migration Notes

- Preserve current output: session id and message count.
- Re-evaluate naming later, but keep `/cost` compatibility during migration.
- Consume SDK session information APIs rather than SDK embedded command internals.

## Acceptance Criteria

- `/cost` is provided by an injected `ICommandModule`.
- Command descriptor and execution are colocated.
- Compatibility with existing `/cost` behavior is retained.

## Test Plan

- Add command module tests for session id/message count output.
- Add compatibility test for command name and output shape.
