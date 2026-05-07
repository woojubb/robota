# Command Migration: `/resume`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-resume-module
- **Scope**: packages/agent-command-session, packages/agent-sdk, packages/agent-cli

## Objective

Migrate `/resume` out of SDK-embedded built-in commands into the session command module while preserving the host-applied `session-picker-requested` effect.

## Plan

- [x] Research the current SDK command owner and CLI session picker effect handling.
- [x] Add SDK session-command common API helper for requesting the session picker effect.
- [x] Add `/resume` metadata and executable command to `@robota-sdk/agent-command-session`.
- [x] Remove `/resume` execution from SDK-default `createSystemCommands()`.
- [x] Add command-module and CLI effect-handler tests.
- [x] Run targeted package verification.
- [x] Run root verification and harness scan.
- [x] Archive this task for PR merge.

## Progress

### 2026-05-03

- Selected `@robota-sdk/agent-command-session` because `/resume` is a session-management command and only requests a host session picker.
- Added `/resume` to the session command module and removed the SDK-embedded implementation.
- Verified with targeted package checks, root `pnpm build`, root `pnpm typecheck`, root `pnpm test`, root `pnpm lint`, `pnpm harness:scan`, and `git diff --check`.

## Decisions

- Keep picker rendering and saved-session selection entirely in the CLI/TUI host. The command module only emits `session-picker-requested`.

## Blockers

- none

## Result

- `/resume` is now owned by `@robota-sdk/agent-command-session`.
- `@robota-sdk/agent-sdk` keeps the shared session-picker effect factory and no longer registers `/resume` in default SDK system commands.
- CLI/TUI opens the session picker through the generic `session-picker-requested` command effect handler.

## Original Backlog

## What

Migrate `/resume` into a command-module owner that requests session picker behavior through typed command effects.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`
- Host application: CLI opens `SessionPicker` from `session-picker-requested`

## Target Owner

Recommended: `@robota-sdk/agent-command-resume` or a session-management command package.

## Migration Notes

- Preserve typed `session-picker-requested` effect.
- Keep picker rendering in CLI/TUI; command implementation only requests the host effect.
- Do not let slash routing branch on `/resume`.

## Acceptance Criteria

- `/resume` is provided by an injected `ICommandModule`.
- Host picker behavior is an effect handled by CLI/TUI.
- Command module has descriptor and executable handler together.

## Test Plan

- Add command module tests for `session-picker-requested`.
- Add CLI effect-handler test for opening the session picker.
