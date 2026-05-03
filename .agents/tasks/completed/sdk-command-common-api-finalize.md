# SDK Command Common API Finalize

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/sdk-command-common-api-finalize
- **Scope**: packages/agent-sdk, .agents/backlog, .agents/tasks

## Objective

Close the SDK command common API backlog after the command-module migration by reconciling the
specification with the implemented final layering and archiving the completed backlog.

## Plan

- [x] Audit implemented `agent-sdk/src/command-api` contracts and command packages.
- [x] Confirm CLI and SDK no longer own user-visible built-in command behavior.
- [x] Update stale SDK SPEC wording that still describes a transitional embedded-command state.
- [x] Archive the backlog with completed acceptance criteria.
- [x] Run targeted SDK command API verification.
- [x] Create PR and merge into `develop`.

## Progress

### 2026-05-03

- Confirmed `packages/agent-sdk/src/command-api` owns contracts, effects, interactions, host context,
  host adapters, and command-facing provider/context/session/runtime/plugin APIs.
- Confirmed user-visible built-ins are implemented in `agent-command-*` packages and composed by CLI.
- Confirmed `pnpm harness:scan:commands` guards SDK/CLI/command-package layering after PR #185.
- Updated SDK SPEC wording from transitional embedded-command language to the final command API
  layering.
- Archived `.agents/backlog/sdk-command-common-api-layer.md`.

## Decisions

- Treat this as a finalization task, not another migration slice. The implementation already matches
  the target layering; the remaining work is stale documentation and backlog state.

## Test Plan

Run SDK command API tests, command layering scan, SDK typecheck/build, docs structure validation, and
`git diff --check`.

## Result

Completed.

Verification passed:

- `volta run pnpm --filter @robota-sdk/agent-sdk test -- src/command-api/__tests__/command-api.test.ts src/commands/__tests__/system-command.test.ts src/commands/__tests__/command-registry.test.ts`
- `volta run pnpm --filter @robota-sdk/agent-sdk typecheck`
- `volta run pnpm --filter @robota-sdk/agent-sdk build`
- `volta run pnpm harness:scan:commands`
- `volta run pnpm docs:validate-structure`
- `git diff --check`
