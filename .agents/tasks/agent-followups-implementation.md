# Agent Follow-ups Implementation

- **Status**: in-progress
- **Created**: 2026-05-03
- **Branch**: feat/agent-followups-implementation
- **Scope**: packages/agent-cli, packages/agent-sdk, packages/agent-sessions, packages/agent-runtime, .agents

## Objective

Implement the follow-up work promoted from backlog: fix the `/model` restart regression, measure `agent-*` package coverage, unify compact command routing and policy, harden worktree support, and add a local-first reversible sandbox/rollback workflow.

## Plan

- [x] Fix `/model` restart behavior with regression tests.
- [x] Measure `agent-*` package coverage and write a report.
- [x] Unify `/compact` around descriptor/system command routing and expose auto-trigger policy.
  - [x] Route CLI legacy `/compact` fallback to SDK system command instead of duplicating execution.
  - [x] Add compact command descriptor metadata.
  - [x] Add configurable/disable-able auto compact threshold.
- [x] Harden worktree metadata, cleanup, and edge-case behavior.
- [x] Add local-first reversible sandbox/rollback workflow built on checkpoints/worktrees.
- [x] Run targeted verification for changed packages.
- [ ] Prepare PR and merge into `develop`.

## Progress

### 2026-05-03

- Created task record and implementation branch.
- Fixed `/model` model persistence so the active highest-precedence provider profile is updated instead of always writing to the user-global settings file.
- Verified targeted agent-cli provider/settings tests, typecheck, and build.
- Ran `agent-*` package coverage and added `.agents/reports/agent-package-coverage-2026-05-03.md`.
- Unified `/compact` through SDK system command routing, added descriptor metadata, exposed `autoCompactThreshold`, and updated context output with the active policy.
- Added dirty worktree handoff metadata (`worktreeStatus`, `worktreeNextAction`) and Git adapter status reporting.
- Added inclusive checkpoint rollback via `/rewind rollback <checkpoint-id>` for local-first reversible edit recovery.
- Verified targeted tests, root typecheck, root build, root lint, and harness verification against `origin/develop`.

## Decisions

- Follow the backlog roadmap order: model regression, coverage audit, compact descriptor, worktree hardening, reversible sandbox.
- Use TDD for behavior changes where existing tests can express the regression.
- Do not add global `agent-*` coverage thresholds yet; the baseline shows package categories differ too much for one fair threshold.
- Keep `/rewind restore` semantics as "restore to the state after the selected checkpoint"; add `/rewind rollback` for inclusive rollback through the selected checkpoint.

## Test Plan

Run focused RED/GREEN tests for each behavior slice, then verify the affected monorepo surface with root commands. Targeted tests cover provider settings precedence, legacy slash routing, SDK system commands, session compaction thresholds, worktree handoff metadata, Git worktree status reporting, checkpoint store rollback, and interactive checkpoint rollback. Final checks use root `pnpm typecheck`, root `pnpm build`, root `pnpm lint`, and harness verification against `origin/develop` with build skipped after the root build has already produced package artifacts.

## Blockers

- None.

## Result

Pending.
