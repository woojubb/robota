# Command Migration: `/cost`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-cost-module
- **Scope**: packages/agent-command-session, packages/agent-sdk, packages/agent-cli

## Objective

Migrate `/cost` session information display out of SDK-default built-ins into the session command module while preserving the legacy output shape.

## Plan

- [x] Research current `/cost` SDK execution and CLI routing.
- [x] Add SDK session-info common API for command modules.
- [x] Add `/cost` metadata and executable command to `@robota-sdk/agent-command-session`.
- [x] Remove `/cost` execution from SDK-default `createSystemCommands()`.
- [x] Route CLI `/cost` through the injected command module.
- [x] Run targeted package verification.
- [x] Run root verification and harness scan.
- [x] Archive this task for PR merge.

## Progress

### 2026-05-03

- Selected `@robota-sdk/agent-command-session` because `/cost` reads session id and message count and does not require host I/O.
- Added SDK `readCommandSessionInfo()` as the common API consumed by the command package.
- Moved command metadata and execution into the session command module.
- Verified with targeted package checks, root `pnpm build`, root `pnpm typecheck`, root `pnpm test`, root `pnpm lint`, `pnpm harness:scan`, and `git diff --check`.

## Decisions

- Keep the command name `/cost` for compatibility even though the current output is session info rather than monetary cost.
- Keep `/cost` user-only and inline because it is a read-only local session information command.

## Blockers

- none

## Result

- `/cost` is now owned by `@robota-sdk/agent-command-session`.
- `@robota-sdk/agent-sdk` keeps the shared session-info read helper and no longer registers `/cost` in default SDK system commands.
- CLI slash routing no longer formats `/cost` output directly and instead routes it through the injected command module.

## Original Backlog

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
