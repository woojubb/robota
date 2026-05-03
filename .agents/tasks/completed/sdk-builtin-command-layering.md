# SDK Built-in Command Layering

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/sdk-builtin-command-layering
- **Scope**: packages/agent-sdk, packages/agent-cli, .agents/backlog

## Objective

Move built-in slash command ownership into injected command modules so command metadata, execution, descriptors, and lifecycle policy have one owner. Keep the CLI as a thin host layer for slash parsing, TUI state, and adapter-backed side effects.

## Plan

- [x] Capture backlog items for compact execution state, auto controls, and built-in command layering.
- [x] Update SDK/CLI specs for command-module ownership and lifecycle metadata.
- [x] Add failing tests for command metadata/execution parity and blocking command lifecycle.
- [x] Implement SDK built-in command module generation from executable system commands.
- [x] Move provider slash command ownership behind SDK command interaction/effect contracts.
- [x] Keep CLI host command modules only for thin host UI commands such as plugin/exit/statusline.
- [x] Remove provider/TUI hardcoded routing from `useSlashRouting` and `useSideEffects`.
- [x] Verify targeted SDK/CLI tests, typecheck, build, lint, and harness scope.

## Test Plan

- Red tests: add SDK provider command module tests and CLI generic slash routing tests before implementation so provider setup/switch behavior must pass through generic command interactions and effects.
- Targeted package verification: run SDK and CLI typecheck, full package test suites, and package lint because this change touches public command contracts, SDK exports, and TUI routing.
- Workspace verification: run root `pnpm build`, root `pnpm typecheck`, root `pnpm lint`, and `git diff --check` to catch cross-package type/export drift, monorepo build ordering problems, lint errors, and whitespace issues.
- Harness verification: run `pnpm harness:verify -- --scope packages/agent-sdk --scope packages/agent-cli --skip-build` after the root build so repository task-plan checks and scoped test/lint/typecheck checks validate the final change.

## Progress

### 2026-05-03

- Created implementation branch from current backlog branch.
- Added backlog documents for compact command execution state, compact auto controls, and SDK built-in command layering.
- Started command-layering implementation using spec-first and TDD workflow.
- Revised the design after boundary review: `/provider` must be an SDK command module with generic `ICommandInteraction` and `TCommandEffect` contracts; CLI/TUI must only render prompts and apply typed host effects.
- Implemented SDK command result interactions/effects, SDK-owned provider command module, SDK built-in metadata generation, and CLI host-only command module.
- Removed provider-specific slash routing and provider setup interaction state from TUI hooks; TUI now stores generic command interactions and applies typed command effects.
- Removed unused provider definition propagation from `renderApp`, `App`, `useInteractiveSession`, and `useSideEffects`.
- Verified SDK/CLI package tests, typechecks, package lint, root build, root typecheck, root lint, and `git diff --check`.
- First harness verification attempt failed on this task document because it lacked a `## Test Plan` section; added the test plan before rerunning.
- Reran `pnpm harness:verify -- --scope packages/agent-sdk --scope packages/agent-cli --skip-build`; it passed for SDK, CLI, and dependent typecheck scopes.

## Decisions

- Use SDK-owned command modules as the source of truth for SDK-default built-ins.
- Keep provider command behavior out of CLI/TUI hooks; expose it through SDK command module interfaces with injected settings adapters.
- Keep CLI-only behavior in CLI command modules only when the behavior is terminal-host UI such as plugin UI, exit, or statusline rendering preferences.
- Treat blocking model-backed commands such as `/compact` as foreground command executions so they share `thinking` and execution guards.

## Blockers

- None.

## Result

Implementation complete. SDK owns built-in command metadata/execution contracts, including `/provider` setup and switching through injected settings adapters. CLI/TUI remains a thin host that renders generic prompts, queues generic command interactions, and applies typed host effects without provider-specific slash routing.
