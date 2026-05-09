# User-Local Inspection Implementation

- **Status**: in-progress
- **Created**: 2026-05-09
- **Branch**: feat/user-local-inspection-initiative
- **Scope**: packages/agent-sdk, packages/agent-command-\*, packages/agent-cli, .agents/backlog

## Objective

Implement the active user-local storage and memory inspection backlogs through focused PRs while
preserving SDK/command ownership and keeping `agent-cli` as routing/UI only.

## Plan

- [ ] Create initiative base branch from `develop`.
- [ ] Implement user-local storage inspection in one child PR.
- [ ] Implement user-local memory inspection in one child PR.
- [ ] Complete the planning umbrella backlog after implementation evidence exists.
- [ ] Merge the initiative into `develop`.

## Progress

### 2026-05-09

- Created initiative base branch `feat/user-local-inspection-initiative` from `develop`.
- Confirmed active backlog items and implementation order.

## Decisions

- Use one child PR per active backlog implementation.
- Keep user-local storage and memory semantics in SDK/command-owned code; CLI may only route
  provider-free commands and render terminal output.

## Blockers

- None.

## Test Plan

- Run targeted builds and tests for each affected package after each backlog implementation.
- Run the backlog-defined User Execution Test Scenario commands for storage and memory after the
  product commands are implemented.
- Run `pnpm harness:verify -- --base-ref origin/develop --skip-dependent-scopes --skip-record-check`
  before pushing initiative changes.
- Run `pnpm harness:scan` before the final merge to `develop`.

## User Execution Test Scenarios

Not applicable to this task-tracking file itself. The runnable product scenarios are owned by the
individual user-local storage and user-local memory backlog items and must be executed after their
implementation PRs.

## Result

Pending.
