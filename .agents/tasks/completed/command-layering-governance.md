# Command Layering Governance

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/sdk-builtin-command-layering
- **Scope**: .agents/rules, .agents/backlog, packages/agent-sdk/docs, packages/agent-cli/docs, scripts/harness

## Objective

Capture the built-in command layering lesson as repository policy and add a mechanical check so command semantics do not drift back into CLI/TUI hooks or SDK orchestration internals. The intended architecture is that SDK exposes command contracts and common APIs, while built-in command implementations behave like command modules composed by product roots.

## Plan

- [x] Update rule documents to define built-in command implementation ownership and the SDK common API boundary.
- [x] Update backlog/spec wording that still implies provider or built-in command semantics belong in CLI/TUI or SDK core.
- [x] Add a harness command-layering scan for mechanically detectable regressions.
- [x] Add harness tests for the new scan and root script wiring.
- [x] Run formatting and targeted harness verification.

## Test Plan

- Run the new command-layering scan directly to confirm the repository satisfies the codified rule.
- Run harness unit tests covering the new scan and script wiring.
- Run `pnpm harness:scan:consistency` because rule/harness governance changes must keep anchors, scripts, and checks aligned.
- Run `git diff --check` after documentation and script edits.

## Progress

### 2026-05-03

- Started after identifying that provider slash command logic repeatedly drifted between CLI/TUI and SDK instead of staying behind command module boundaries.
- Updated layered assembly rules, common mistakes, project structure, package specs, and built-in command layering backlog so SDK owns contracts/common APIs while command modules own command implementations.
- Added `check-command-layering.mjs` and wired it into root `harness:scan` as `harness:scan:commands`.
- Verified with `pnpm harness:scan:commands`, targeted harness unit tests, `pnpm harness:scan:consistency`, `pnpm harness:scan:test-plans`, and `git diff --check`.

## Decisions

- SDK may expose generic command contracts and reusable provider/settings common APIs.
- Built-in command implementations should be isolated command modules selected by composition, not CLI/TUI branches or SDK orchestration special cases.
- Mechanical checks should enforce the regressions that are cheap to detect without blocking unrelated existing legacy migration targets.

## Blockers

- None.

## Result

Completed. Repository rules now state that built-in commands are default-composed command modules, not SDK/CLI-owned hardcoded flows. The harness now includes a command-layering scan that blocks provider slash command state/flow from returning to CLI/TUI hooks and blocks `agent-sdk` from depending on `agent-command-*` implementations.
