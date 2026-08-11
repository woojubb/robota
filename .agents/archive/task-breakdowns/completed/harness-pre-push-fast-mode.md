# Harness Pre-Push Fast Mode

- **Status**: completed
- **Created**: 2026-05-08
- **Branch**: fix/harness-pre-push-fast-mode
- **Scope**: scripts/harness, .agents/rules

## Objective

Reduce unnecessary pre-push latency while preserving explicit full verification paths. Pre-push should remain a local fast gate and deeper dependent verification should be opt-in or CI-owned.

## Plan

- [x] Inspect current harness planning and pre-push behavior.
- [x] Add a configurable fast pre-push mode that avoids repeated broad dependent checks by default.
- [x] Keep full verification available through an explicit mode.
- [x] Update repository guidance and tests.
- [x] Run targeted verification.

## Progress

### 2026-05-08

- Started after provider setup PR #302 exposed excessive pre-push runtime.
- Recommended defaulting pre-push to directly changed scopes and making full dependent verification explicit.
- Found that `createVerificationPlan` always expands dependent scopes for entrypoint/public-surface changes, and `pre-push.mjs` always runs that full plan.
- Added `--skip-dependent-scopes` to planning and verification, then made `harness:pre-push` default to fast mode while preserving `HARNESS_PRE_PUSH_MODE=full`.
- Found and fixed an existing manual pre-push skip bug: dirty working tree changes no longer get treated as tree-equivalent to the base branch.
- Verified the new fast path with harness plan fixtures, targeted harness unit tests, consistency/worktree scans, and actual `pnpm harness:pre-push`.

## Decisions

- Keep `pnpm harness:verify` broad by default for intentional manual verification.
- Make only `pnpm harness:pre-push` fast by default because it is a push-time safety net and should not duplicate CI-grade dependent validation unless explicitly requested.
- Treat tree-equivalent skip as valid only when the working tree is clean.

## Blockers

- None.

## Test Plan

- Run harness plan fixtures with and without `--skip-dependent-scopes` to prove fast mode removes dependent scope expansion while full mode keeps it.
- Run harness script unit tests for option parsing, pre-push policy markers, and verification plan behavior.
- Run worktree, consistency, and task-plan scans through `pnpm harness:pre-push` so the actual fast local gate validates this change.

## Result

Completed. Default pre-push now skips dependent scope expansion, full dependent validation remains explicit via `HARNESS_PRE_PUSH_MODE=full`, and manual pre-push no longer skips dirty working tree changes.
