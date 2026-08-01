# Background Task Layer Specification

- **Status**: completed
- **Created**: 2026-04-30
- **Branch**: feat/background-task-layer
- **Scope**: .agents/specs

## Objective

Write a cross-cutting specification for a composable background task architecture that supports managed background agents and processes while preserving Robota's layered library composition model.

## Plan

- [x] Define ownership boundaries across core, tools, sessions, sdk, transports, and cli.
- [x] Specify the generic background task manager, runner ports, state machine, and event model.
- [x] Specify how agent and process tasks compose on top of the generic layer.
- [x] Specify TUI and transport projection boundaries.
- [x] Update cross-cutting specs index.

## Test Plan

- Run `pnpm harness:scan:specs`.
- Run `pnpm harness:scan`.

## Progress

### 2026-04-30

- Started spec authoring from completed background task layer research.
- Added `.agents/specs/background-task-layer.md`.
- Updated `.agents/specs/README.md` with the new cross-cutting spec.
- Updated `.agents/specs/subagent-process-manager.md` to reference the shared runtime layer.
- Ran `pnpm harness:scan:specs` and `pnpm harness:scan`.

## Decisions

- The generic background task layer is the source of truth; subagent process management becomes an agent-task specialization.

## Blockers

- None.

## Result

- Background task layer architecture spec is written. It defines a generic SDK-owned manager, pure lifecycle state machine, runner ports, agent/process specializations, TUI/transport projections, permission model, logging, cancellation, tests, and implementation order.
