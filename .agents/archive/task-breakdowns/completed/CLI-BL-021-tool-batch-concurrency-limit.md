# Tool Batch Concurrency Limit

- **Status**: completed
- **Created**: 2026-04-30
- **Branch**: feat/subagent-manager-core
- **Scope**: packages/agent-core, .agents/specs

## Objective

Enforce `maxConcurrency` for parallel tool batch execution so future subagent orchestration can rely on bounded parallel work rather than unbounded `Promise.all` execution.

## Plan

- [x] Add a unit test that proves parallel tool execution starts no more than `maxConcurrency` tools at once.
- [x] Implement bounded parallel execution while preserving per-request result mapping and existing error behavior.
- [x] Run targeted `agent-core` verification.
- [x] Archive this task with the implementation result.

## Progress

### 2026-04-30

- Started implementation on `feat/subagent-manager-core`.
- Added a failing unit test for parallel `maxConcurrency` enforcement, then implemented bounded worker-pool execution and confirmed the targeted test passes.
- Verified `agent-core` tests, typecheck, lint, and build pass. Lint still reports existing package warnings, with no errors.
- Updated package and cross-cutting specs so the documented concurrency contract matches the implementation.
- Ran `pnpm harness:scan`; it passed with existing file-size warnings reported by the scan.

## Decisions

- Keep the change inside the existing tool batch helper so callers that already pass `maxConcurrency` gain the behavior without API changes.

## Blockers

- None.

## Result

- `maxConcurrency` now bounds parallel tool execution with a worker pool while preserving per-request result order and existing error aggregation behavior.
- Added a unit test that fails on unbounded parallel startup and passes with the bounded implementation.
- Updated `agent-core` and subagent process manager specs for the completed concurrency slice.
- Repository harness scan passes for this change.
