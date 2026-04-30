# Agent Tool SubagentManager Route

- **Status**: completed
- **Created**: 2026-04-30
- **Branch**: feat/subagent-manager-core
- **Scope**: packages/agent-sdk

## Objective

Route the model-callable `Agent` tool through `SubagentManager` in foreground mode while preserving the existing JSON result shape for callers.

## Plan

- [x] Add a unit test proving `Agent` tool uses an injected manager for `spawn()` and `wait()`.
- [x] Add an in-process runner adapter so default `Agent` tool behavior still creates and runs subagent sessions.
- [x] Wire session-created Agent tools to a per-session `SubagentManager`.
- [x] Update SDK specs and run targeted verification.
- [x] Archive this task with the implementation result.

## Progress

### 2026-04-30

- Started follow-up slice on `feat/subagent-manager-core` after tool batch concurrency was pushed to PR #100.
- Added a failing unit test for injected `SubagentManager` routing, then connected `Agent` tool foreground execution to `spawn()` and `wait()`.
- Added `createInProcessSubagentRunner()` so the default managed path still uses isolated subagent sessions.
- Verified targeted Agent tool tests, full `agent-sdk` tests, typecheck, lint, and build. Lint reports existing warnings with no errors.
- Updated `agent-sdk` and cross-cutting subagent specs for the completed foreground manager route.
- Ran repository `pnpm harness:scan`; it passes with existing file-size warnings reported by the scan.

## Decisions

- Keep foreground compatibility first: the `Agent` tool should still return `{ success, output, agentId }` while using the manager internally.

## Test Plan

- Add a unit test where a fake `SubagentManager` is injected into `createAgentTool()`, then assert the tool calls `spawn()` with a foreground job request and `wait()` with the returned job id.
- Keep existing Agent tool tests passing to prove the default in-process runner still creates subagent sessions, forwards callbacks, applies model overrides, preserves unknown-agent errors, and returns the existing JSON result shape.
- Run targeted Agent tool tests, full `agent-sdk` tests, `agent-sdk` typecheck, lint, build, and repository `harness:scan`.

## Blockers

- None.

## Result

- `Agent` tool foreground calls now run through `SubagentManager` while preserving the existing `{ success, output, agentId }` result shape.
- `createSession()` wires a per-session manager backed by the in-process runner.
- `ISubagentManager`, `createInProcessSubagentRunner()`, and runner deps are exported from `agent-sdk` for follow-up integration work.
