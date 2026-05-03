# Command Migration: `/rename`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-rename-module
- **Scope**: packages/agent-command-session, packages/agent-sdk, packages/agent-cli

## Objective

Migrate `/rename` out of SDK-embedded built-in commands into the session command module package while preserving the existing `session-renamed` host effect contract.

## Plan

- [x] Research the current SDK command owner, CLI effect handling, and session command package shape.
- [x] Add SDK session-command common API helpers for rename argument parsing/effect creation.
- [x] Add `/rename` metadata and executable command to `@robota-sdk/agent-command-session`.
- [x] Remove `/rename` execution from SDK-default `createSystemCommands()`.
- [x] Add command-module and CLI effect-handler tests.
- [x] Run targeted package verification.
- [x] Run root verification and harness scan.
- [x] Archive this task for PR merge.

## Progress

### 2026-05-03

- Selected `@robota-sdk/agent-command-session` instead of a one-command package because `/clear` and `/rename` share the session-management command domain and SDK command-facing session APIs.
- Added `/rename` implementation to the session command module and removed the SDK-embedded implementation.
- Completed targeted verification plus root `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm harness:scan`, and `git diff --check`.

## Decisions

- Keep `session-renamed` as a typed host-applied effect. Session title/status/persistence are host/UI concerns and must not be mutated directly by the command package.

## Blockers

- none

## Result

- `/rename` is now owned by `@robota-sdk/agent-command-session`.
- SDK core keeps only session command common API helpers and no longer includes `/rename` in default `createSystemCommands()`.
- CLI applies `session-renamed` through the generic command effect handler, with coverage for the effect boundary.

## Original Backlog

## What

Migrate `/rename` into a command-module owner that requests session rename through typed command effects or SDK session APIs.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`
- Host application: CLI applies `session-renamed`

## Target Owner

Recommended: `@robota-sdk/agent-command-rename` or a session-management command package.

## Migration Notes

- Preserve usage behavior for missing name.
- Preserve typed `session-renamed` effect unless SDK session rename API is sufficient for all hosts.
- Ensure terminal title/session status update remains CLI rendering behavior.

## Acceptance Criteria

- `/rename` is provided by an injected `ICommandModule`.
- Command output/effect contract is tested.
- CLI/TUI only applies the typed effect.

## Test Plan

- Add command module tests for missing name and valid rename.
- Add CLI effect-handler test for session name state update.
