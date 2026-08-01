# Command Migration: `/exit`

- **Status**: completed
- **Completed**: 2026-05-03
- **Branch**: feat/command-exit-module

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

- [x] `/exit` is provided by a command-module owner.
- [x] CLI/TUI only applies the typed shutdown effect.
- [x] No slash router branch owns exit behavior.

## Test Plan

- [x] Add command module tests for `session-exit-requested`.
- [x] Add CLI routing tests proving `/exit` falls through to the injected command module.

## Result

Created `@robota-sdk/agent-command-exit`, added SDK session effect helper coverage, composed the module in the Robota CLI default command set, and removed `/exit` ownership from the CLI host command module and slash router.
