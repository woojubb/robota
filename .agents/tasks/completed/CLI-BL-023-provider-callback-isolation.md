# Provider Callback Isolation

- **Status**: completed
- **Created**: 2026-04-30
- **Branch**: feat/subagent-manager-core
- **Scope**: packages/agent-core, packages/agent-sessions

## Objective

Prevent parent and subagent sessions that share a provider instance from overwriting each other's streaming text callbacks.

## Plan

- [x] Add a regression test proving two sessions sharing one provider keep `onTextDelta` callbacks isolated.
- [x] Thread `onTextDelta` through per-run options/context instead of relying on mutable provider-level callback state.
- [x] Preserve existing provider-level callback behavior for direct Robota/provider callers.
- [x] Update specs and run targeted verification.
- [x] Archive this task with the result.

## Test Plan

- Create two `Session` instances with the same provider and different `onTextDelta` callbacks. Run the first session after constructing the second session, then assert only the first callback receives streamed text.
- Run targeted `agent-sessions` tests for the new regression and compaction behavior, plus `agent-core` execution tests affected by the new run option.
- Run package typecheck/build/lint for touched packages and repository `harness:scan`.

## Progress

### 2026-04-30

- Started provider callback isolation slice after `Agent` tool foreground manager routing was pushed to PR #100.
- Added a failing regression test showing a later child session could overwrite the parent's streaming callback when the same provider instance was shared.
- Added `IRunOptions.onTextDelta` and `IExecutionContext.onTextDelta`, then routed session streaming through per-run context.
- Removed `Session` provider callback mutation while preserving provider-level callback fallback for lower-level callers.
- Updated package and subagent process manager specs.
- Verified `agent-core` and `agent-sessions` tests, typecheck, lint, and build for the touched scope.

## Decisions

- Use per-run callback context as the isolation boundary. Provider-level callback fallback remains available for direct lower-level use.

## Blockers

- None.

## Result

- Parent and subagent sessions sharing one provider now keep streaming callbacks isolated per run. `Session` stores its callback and passes it into `Robota.run()`, while `executeRound` and forced summary streaming prefer run-scoped callbacks before falling back to provider-level callback state.
