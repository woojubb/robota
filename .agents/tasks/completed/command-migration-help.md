# Command Migration Help

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-help-module
- **Scope**: packages/agent-command-help, packages/agent-sdk, packages/agent-cli

## Objective

Move `/help` out of SDK embedded system-command ownership and into a composable command module. Keep SDK ownership limited to generic command-list formatting APIs that an external command package can consume.

## Plan

- [x] Define SDK-owned help formatting/common API.
- [x] Add `@robota-sdk/agent-command-help` with command metadata, executable command, tests, docs, and publish metadata.
- [x] Remove SDK-default `/help` command ownership from `createSystemCommands()`.
- [x] Compose the help module from the CLI product entrypoint and remove the CLI legacy `/help` route.
- [x] Update backlog, specs, and user-facing docs without editing generated API reference files.
- [x] Run targeted and repository verification.
- [x] Prepare the branch for commit, push, PR, and merge into `develop`.

## Progress

### 2026-05-03

- Started from `develop` on `feat/command-help-module`.
- Researched current `/help` ownership in SDK `system-command.ts`, `BuiltinCommandSource`, CLI `slash-executor.ts`, and command-module package patterns.
- Added SDK help common API and `@robota-sdk/agent-command-help`.
- Removed SDK/CLI-owned `/help` execution and updated registry aggregation tests to use injected command module sources.
- Ran targeted SDK/CLI/help package checks and root build, typecheck, test, lint, harness scan, docs build, and diff whitespace check.

## Decisions

- Use a dedicated `@robota-sdk/agent-command-help` package because `/help` is a user-visible internal command and should follow the same package boundary as other migrated built-ins.
- Keep SDK common API generic: format a supplied command list from `ICommandHostContext.listCommands()` and expose the command description constant.

## Test Plan

- Run targeted `agent-sdk`, `agent-command-help`, and `agent-cli` tests for command metadata, help formatting, command registry aggregation, and legacy slash routing fallthrough.
- Run package build, typecheck, and lint for the new help command package and affected SDK/CLI surfaces.
- Run root `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm harness:scan`, `pnpm docs:build`, and `git diff --check` before merging.

## Blockers

- None.

## Result

Implemented `/help` as a composable command module, moved SDK ownership to generic help formatting APIs, and removed legacy CLI `/help` handling. Repository verification passed; lint and harness file-size scans reported existing warnings only.
