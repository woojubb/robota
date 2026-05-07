# Command Migration: `/statusline`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-statusline-module
- **Scope**: packages/agent-command-statusline, packages/agent-sdk, packages/agent-cli

## What

Migrate `/statusline` from CLI-local command module into a command-module owner with an explicit host settings adapter/effect contract.

## Current Owner

- Implementation: `packages/agent-cli/src/commands/statusline-command-module.ts`
- Host settings application: CLI/TUI status line hooks

## Target Owner

`@robota-sdk/agent-command-statusline`

## Migration Notes

- Preserve subcommands: `on`, `off`, `reset`, `git`.
- Preserve typed `statusline-settings-patch` effect or replace with an injected host adapter.
- Status bar rendering remains CLI-owned.

## Acceptance Criteria

- [x] `/statusline` has a command-module owner with metadata/execution together.
- [x] CLI/TUI only applies status line patch effects and renders state.
- [x] No slash router branch owns statusline behavior.
- [x] Statusline patch types live in SDK command common APIs, not CLI command implementation.

## Test Plan

- [x] Add command module tests for all statusline subcommands.
- [x] Add descriptor tests for user-only invocation policy and subcommand metadata.
- [x] Add effect-handler tests for applying settings patches.
- [x] Add CLI composition/routing tests proving `/statusline` is registry-owned.

## Progress

### 2026-05-03

- Promoted backlog item to an active task.
- Selected a dedicated `@robota-sdk/agent-command-statusline` package because `/statusline` is a settings command that can be hosted outside the CLI while the CLI remains responsible only for rendering/applying TUI status line state.
- Implemented SDK statusline common APIs, the new command module package, CLI composition changes, typed effect handling, docs, and coverage reporting updates.
- Verified targeted command behavior plus root build, typecheck, test, lint, harness scan, and whitespace diff checks.

## Decisions

- Preserve the existing `statusline-settings-patch` host effect instead of writing settings directly from the command, because the effect keeps command execution UI-agnostic and lets the CLI/TUI decide how to apply and render status line state.
- Move statusline patch shape and command metadata helpers into SDK command common APIs so the command package does not import CLI utility types.

## Blockers

- None.

## Result

Completed. `/statusline` now lives in `@robota-sdk/agent-command-statusline`, emits typed SDK `statusline-settings-patch` effects, and is routed by the CLI through the injected command registry while the CLI/TUI remains responsible for applying settings and rendering the status bar.
