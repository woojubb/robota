# Command Migration: `/statusline`

## What

Migrate `/statusline` from CLI-local command module into a command-module owner with an explicit host settings adapter/effect contract.

## Current Owner

- Implementation: `packages/agent-cli/src/commands/statusline-command-module.ts`
- Host settings application: CLI/TUI status line hooks

## Target Owner

Recommended: `@robota-sdk/agent-command-statusline` if reused across hosts; otherwise keep a clearly isolated CLI-default command module with the same contract and no TUI hook command branches.

## Migration Notes

- Preserve subcommands: `on`, `off`, `reset`, `git`.
- Preserve typed `statusline-settings-patch` effect or replace with an injected host adapter.
- Status bar rendering remains CLI-owned.

## Acceptance Criteria

- `/statusline` has a command-module owner with metadata/execution together.
- CLI/TUI only applies status line patch effects and renders state.
- No slash router branch owns statusline behavior.

## Test Plan

- Add command module tests for all statusline subcommands.
- Add effect-handler tests for applying settings patches.
