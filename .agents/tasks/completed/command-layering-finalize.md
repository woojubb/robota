# Command Layering Finalize

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-layering-finalize
- **Scope**: packages/agent-cli, scripts/harness, .agents

## Objective

Finish the built-in command layering migration by removing the remaining legacy CLI slash command
switch/test helper, recording the command inventory, and adding mechanical guardrails that prevent
command-specific branches from returning to CLI-owned command code.

## Checklist

- [x] Audit current command ownership and remaining CLI command-specific code.
- [x] Remove `slash-executor.ts` and its legacy test suite.
- [x] Remove the legacy CLI-local `PluginCommandSource` copy and tests.
- [x] Add command inventory/classification documentation.
- [x] Extend command-layering harness checks for legacy CLI command/source files.
- [x] Update package docs and backlog state.
- [x] Run targeted CLI and harness verification.
- [x] Create PR and merge into `develop`.

## Progress

### 2026-05-03

- Created task record and branch.
- Confirmed the TUI path already routes slash commands through `session.executeCommand()` and skill/plugin fallback in `useSlashRouting`.
- Found `packages/agent-cli/src/commands/slash-executor.ts` is no longer in the main flow and only exists as a legacy parser test helper.
- Removed the legacy slash executor and CLI-local plugin command source.
- Added `.agents/specs/command-inventory.md`.
- Added harness guards for legacy CLI command-source files and expanded command-specific router branch detection.
- Fixed `bin.ts` so default command modules are composed once by `startCli()`.

## Decision

Remove the legacy helper and test-only CLI plugin source instead of keeping compatibility shims.
Robota is still beta, neither helper is public API, and retaining duplicate command sources creates
a misleading precedent for command ownership.

## Test Plan

Run the CLI command/UI tests affected by removing the helper, command-layering harness tests, direct
`pnpm harness:scan:commands`, CLI typecheck/build/lint, docs structure validation, and `git diff --check`.

## Result

Completed.

Verification passed:

- `volta run pnpm vitest run scripts/harness/__tests__/check-command-layering.test.mjs`
- `volta run pnpm --filter @robota-sdk/agent-cli typecheck`
- `volta run pnpm --filter @robota-sdk/agent-cli test -- src/commands/__tests__/builtin-source.test.ts src/commands/__tests__/command-registry.test.ts src/commands/__tests__/skill-source.test.ts src/ui/__tests__/slash-routing-effects.test.ts src/ui/__tests__/compact-event-bridge.test.ts`
- `volta run pnpm --filter @robota-sdk/agent-cli test`
- `volta run pnpm --filter @robota-sdk/agent-cli build`
- `volta run pnpm --filter @robota-sdk/agent-cli lint` (38 existing warnings, 0 errors)
- `volta run pnpm harness:scan:commands`
- `volta run pnpm docs:validate-structure`
- `git diff --check`
