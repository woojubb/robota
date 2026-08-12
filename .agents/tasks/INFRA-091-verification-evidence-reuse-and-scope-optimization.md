---
title: 'INFRA-091: Verification Evidence Reuse and Scope Optimization'
status: in-progress
created: 2026-08-13
priority: high
urgency: now
area: scripts/harness, GitHub Actions CI, agent-transport-tui verification, verification policy
depends_on: []
---

# INFRA-091 Verification Evidence Reuse and Scope Optimization

- **Branch**: feat/arch-dag-runtime-completion
- **Spec**: `.agents/spec-docs/active/INFRA-091-verification-evidence-reuse-and-scope-optimization.md`

## Objective

Make executable verification match the repository's proportional-check and no-duplicate policy while
preserving fail-closed required-check coverage. Remove exact duplicate suites, reuse only exact full-gate
evidence, narrow safe developer-only manifest changes, separate harness and product applicability, reduce
redundant PTY process coverage, and batch full-scope package commands within the existing resource ceiling.

## Plan

- [ ] TC-01: Give the harness suite one owner per local/CI execution graph and reject unknown selective omissions.
- [ ] TC-02: Add exact clean-tree full-gate receipts and fail-closed pre-push reuse.
- [ ] TC-03: Classify root manifest deltas semantically with an allowlist-only narrow path.
- [ ] TC-04: Separate harness/product/TUI/examples CI applicability without skipping required conclusions.
- [ ] TC-05: Retain exhaustive IME unit coverage and reduce real PTY cases to representative boundaries.
- [ ] TC-06: Batch full-workspace package-owned checks with bounded concurrency and complete result evidence.
- [ ] TC-07: Emit per-stage and total timings; partial runs never certify a full receipt.
- [ ] TC-08: Synchronize verification policy, cross-cutting plan, and TUI test-strategy SPEC.
- [ ] TC-09: Run focused RED/GREEN tests, scans, TUI verification, User Execution Test Scenarios, and final CI-equivalent gate.

## Test Plan

Use TDD in small increments. First add failing tests for selective repository-check omission and ownership,
receipt identity/invalidation and pre-push sequence, root manifest semantic classification, CI capability
outputs/fail-closed job applicability, representative PTY enumeration, bounded aggregate execution evidence,
and timing/partial-receipt behavior. Run each focused file to observe RED before implementing GREEN. Then run
the complete harness suite, harness scan, TUI unit/PTy suites, and the post-change CI-equivalent gate. Record
exact commands, counts, elapsed timing, and the three User Execution Test Scenario outputs in Progress/Result.

## User Execution Test Scenarios

### Scenario 1: Reuse a completed full gate at push

- Prerequisites: a clean committed branch with installed dependencies and build output.
- Commands: `pnpm harness:verify-like-ci`, followed by `git push` for that exact unchanged commit.
- Expected: the full gate records an exact receipt and pre-push reports receipt reuse without rerunning verification.
- Cleanup: none; the receipt is stored under the clone's Git common directory and invalidates automatically.
- Evidence: pending.

### Scenario 2: Narrow developer-script manifest change

- Prerequisites: a fixture comparing root manifests where only `lint:fix` or `lint:fix:staged` differs.
- Command: `pnpm harness:plan -- --base-ref <fixture-base>`.
- Expected: the output states `Root manifest: developer-quality-only` and selects 0 product scopes; a build-script fixture selects every scope.
- Cleanup: remove the temporary fixture/worktree.
- Evidence: pending.

### Scenario 3: Harness-only required CI applicability

- Prerequisites: a changed-file fixture containing only `scripts/harness/**` paths.
- Command: `node scripts/harness/classify-changed-paths.mjs --base-ref <fixture-base>`.
- Expected: `code=true`, `product=false`, `tui=false`, and `examples=false`; required workflow jobs retain explicit non-applicable steps.
- Cleanup: remove the temporary fixture/worktree.
- Evidence: pending.

## Progress

### 2026-08-13

- Measured a roughly 16-minute local gate and identified duplicate harness, 86-scope serial, and PTY costs.
- Completed prior-art research, architecture/adversarial review, GATE-WRITE, and GATE-APPROVAL.

## Decisions

- Preserve stable required jobs and give each substantive check one owner instead of path-filtering jobs away.
- Treat receipts as exact correctness evidence, never as prefix/fuzzy performance cache hits.
- Keep unknown classifier and manifest cases on the broad fail-closed path.
- Preserve package-script ownership and existing concurrency ceilings.

## Blockers

- None.

## Result

Pending implementation and verification.
