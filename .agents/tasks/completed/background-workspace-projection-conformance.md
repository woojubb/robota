# Background Workspace Projection Conformance

## Status

Completed.

## Created

2026-05-09

## Completed

2026-05-09

## Source Backlog

`.agents/backlog/background-workspace-projection-conformance.md`

## Recommendation

Implement a source-backed conformance guard without redesigning the background task APIs.

Reason:

- `agent-runtime` already owns `BackgroundTaskManager`.
- `agent-sdk` already owns execution workspace projection and `InteractiveSession` APIs.
- `agent-cli` already renders SDK execution workspace snapshots.
- The main remaining risk is regression: CLI code reintroducing durable lifecycle, retention,
  unread, or grouping policy.

## Source Audit Result

- `agent-runtime` owns `BackgroundTaskManager` under `packages/agent-runtime/src/background-tasks/`.
- `agent-sdk` owns `createExecutionWorkspaceSnapshot`, execution workspace types, detail readers,
  and `InteractiveSession` workspace APIs.
- `agent-cli` consumes `getExecutionWorkspaceSnapshot`, `execution_workspace_event`, and
  `readExecutionWorkspaceDetail` in `useInteractiveSession`.
- `agent-cli` TUI state syncs snapshots through `TuiStateManager.syncExecutionWorkspaceSnapshot`.
- Architecture map and CLI SPEC both state that background workspace/read-model ownership belongs
  to SDK/runtime and CLI renders projections only.

## Completed Changes

- Added `scripts/harness/check-background-workspace-conformance.mjs`.
- Added `pnpm harness:scan:background-workspace`.
- Wired the check into `pnpm harness:scan` and harness consistency required scripts.
- Added tests for the valid SDK/runtime-owned flow, direct CLI runtime imports, CLI-owned retention
  policy, and missing CLI snapshot/event consumption.

## Test Strategy

This is a conformance guard for an existing architecture boundary. Verification covers the guard
directly and then confirms root harness scan integration.

## Verification

- `pnpm exec vitest run scripts/harness/__tests__/check-background-workspace-conformance.test.mjs`
- `pnpm harness:scan:background-workspace`
