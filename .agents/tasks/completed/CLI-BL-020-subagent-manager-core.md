---
title: CLI-BL-020 Subagent manager core implementation
status: completed
priority: high
urgency: now
created: 2026-04-30
branch: feat/subagent-manager-core
packages:
  - agent-sdk
  - agent-core
  - agent-cli
---

# CLI-BL-020: Subagent Manager Core Implementation

## Objective

Implement the first slice of the Subagent Process Manager spec: a testable SDK-owned manager/runner contract with job lifecycle state, bounded concurrency, wait, cancel, and close semantics.

## Plan

- [x] Add failing unit tests for manager lifecycle and concurrency behavior.
- [x] Add subagent runtime types and runner port.
- [x] Implement `SubagentManager` with in-memory job registry.
- [x] Export SDK types for future Agent tool and TUI integration.
- [x] Update package SPEC.md to reflect the new SDK-owned manager contract.
- [x] Run targeted `agent-sdk` tests/build.

## Test List

- [x] Given a spawn request, when runner starts, then the job moves from queued to running.
- [x] Given a successful runner result, when it resolves, then the job moves to completed and stores output.
- [x] Given a runner failure, when it rejects, then the job moves to failed and stores the error message.
- [x] Given a running job, when cancel is requested, then only that job is cancelled.
- [x] Given `maxConcurrent = 1`, when two jobs are spawned, then only one starts until the first completes.
- [x] Given a completed job, when close is requested, then it is removed from the registry.

## Progress

### 2026-04-30

- Created implementation branch from merged `develop`.
- Started the core manager slice.
- Added `SubagentManager`, subagent runtime types, and unit tests in `agent-sdk`.
- Exported manager contracts from `@robota-sdk/agent-sdk`.
- Updated `packages/agent-sdk/docs/SPEC.md`.
- Verified with `agent-sdk` test/typecheck/lint/build and `harness:scan:specs`.

## Decisions

- Start with a pure in-memory manager and runner port in `agent-sdk`.
- Leave child process runner, Agent tool integration, provider isolation, and TUI rendering for follow-up slices.

## Blockers

- None.

## Result

Completed the first implementation slice for the SDK-owned subagent manager core. Follow-up slices should connect the `Agent` tool to the manager, add background mode events to `InteractiveSession`, and implement the CLI child-process runner.
