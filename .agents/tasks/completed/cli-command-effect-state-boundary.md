# CLI Command Effect State Boundary

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: fix/cli-command-effect-boundary
- **Scope**: packages/agent-cli, packages/agent-sdk command result integration docs

## Objective

Remove implicit command interaction/effect transport through ad hoc fields on `InteractiveSession`.
The CLI should keep command result state in a CLI-owned controller or React state while command
packages continue returning typed SDK `ICommandResult` values.

## Plan

- [x] Characterize current slash routing effect behavior with tests.
- [x] Introduce an explicit CLI-owned command effect boundary.
- [x] Remove `_pendingCommandInteraction`, `_pendingCommandEffects`, and
      `InteractiveSession & ISideEffects` casts.
- [x] Update slash routing/effect tests for the explicit boundary.
- [x] Update `ARCHITECTURE-MAP.md` and archive the backlog item.
- [x] Run targeted CLI verification and harness scans.

## Progress

### 2026-05-05

- Started from `develop` on branch `fix/cli-command-effect-boundary`.
- Added a failing slash-routing test expectation for an explicit command effect queue.
- Implemented `CommandEffectQueue` and wired it through `useInteractiveSession`, `useSlashRouting`,
  `App`, and `useSideEffects`.
- Removed command effect/interactions from the `ISideEffects` session mutation path.
- Added command-layering harness coverage for the old `_pendingCommand*` session-state pattern.
- Updated `ARCHITECTURE-MAP.md` and moved the backlog item to completed.
- Verified CLI tests, CLI typecheck/build, docs build, command-layering scan, test-plan scan, and
  harness regression tests.

## Decisions

- Follow the target architecture from `packages/agent-cli/docs/ARCHITECTURE-MAP.md`: command
  result/effect state belongs to the CLI host boundary, not the SDK session instance.
- Use a small FIFO queue rather than adding an SDK result channel because only the Ink host needs
  this post-submit handoff today.

## Blockers

- None.

## Test Plan

- Run the existing slash routing tests first to confirm the current behavior and identify the
  assertions that depend on `_pending*` session mutation.
- Run targeted CLI tests after implementation, including `slash-routing-effects`.
- Run `pnpm --filter @robota-sdk/agent-cli typecheck`, `pnpm --filter @robota-sdk/agent-cli build`,
  and command-layer harness scans because this change touches CLI/SDK command boundaries.

## Result

Completed. Command results now pass from slash routing to side-effect application through an
explicit CLI-owned queue, and the old session-mutation pattern is covered by the command-layering
harness.
