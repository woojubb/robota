# Command Migration: `/reload-plugins`

## What

Migrate `/reload-plugins` from CLI host command grouping into a command-module owner with real plugin reload semantics or remove it if it is only a placeholder.

## Current Owner

- Implementation: `packages/agent-cli/src/commands/cli-host-command-module.ts`

## Target Owner

Recommended: group with `@robota-sdk/agent-command-plugin` so plugin-related commands share one command package.

## Migration Notes

- Current behavior returns `Plugins reload complete.` without an explicit reload adapter.
- Decide whether the command should call an injected plugin loader/reload adapter or be removed from default command palette.
- Keep CLI/TUI generic; no slash router branch.

## Acceptance Criteria

- `/reload-plugins` is provided by a command-module owner or intentionally removed with compatibility notes.
- If retained, it uses an injected plugin reload adapter and reports real reload result.
- Tests prevent a no-op success placeholder from masking reload failures.

## Test Plan

- Add command module tests for reload success/failure through a fake adapter.
- Add integration test proving command registry includes or intentionally excludes `/reload-plugins`.
