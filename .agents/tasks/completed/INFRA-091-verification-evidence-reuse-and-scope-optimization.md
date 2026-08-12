---
title: 'INFRA-091: Verification Evidence Reuse and Scope Optimization'
status: done
created: 2026-08-13
completed: 2026-08-13
priority: high
urgency: now
area: scripts/harness, GitHub Actions CI, agent-transport-tui verification, verification policy
depends_on: []
---

# INFRA-091 Verification Evidence Reuse and Scope Optimization

- **Branch**: feat/arch-dag-runtime-completion
- **Spec**: `.agents/spec-docs/done/INFRA-091-verification-evidence-reuse-and-scope-optimization.md`

## Objective

Make executable verification match the repository's proportional-check and no-duplicate policy while
preserving fail-closed required-check coverage. Remove exact duplicate suites, reuse only exact full-gate
evidence, narrow safe developer-only manifest changes, separate harness and product applicability, reduce
redundant PTY process coverage, and batch full-scope package commands within the existing resource ceiling.

## Plan

- [x] TC-01: Give the harness suite one owner per local/CI execution graph and reject unknown selective omissions.
- [x] TC-02: Add exact clean-tree full-gate receipts and fail-closed pre-push reuse.
- [x] TC-03: Classify root manifest deltas semantically with an allowlist-only narrow path.
- [x] TC-04: Separate harness/product/TUI/examples CI applicability without skipping required conclusions.
- [x] TC-05: Retain exhaustive IME unit coverage and reduce real PTY cases to representative boundaries.
- [x] TC-06: Batch full-workspace package-owned checks with bounded concurrency and complete result evidence.
- [x] TC-07: Emit per-stage and total timings; partial runs never certify a full receipt.
- [x] TC-08: Synchronize verification policy, cross-cutting plan, and TUI test-strategy SPEC.
- [x] TC-09: Run focused RED/GREEN tests, scans, TUI verification, record the independent User Execution
      `NOT-APPLICABLE` disposition, and run the final CI-equivalent gate.

## Test Plan

Use TDD in small increments. First add failing tests for selective repository-check omission and ownership,
receipt identity/invalidation and pre-push sequence, root manifest semantic classification, CI capability
outputs/fail-closed job applicability, representative PTY enumeration, bounded aggregate execution evidence,
and timing/partial-receipt behavior. Run each focused file to observe RED before implementing GREEN. Then run
the complete harness suite, harness scan, TUI unit/PTy suites, and the post-change CI-equivalent gate. Record
exact commands, counts, elapsed timing, and the independently judged User Execution applicability outcome
in Progress/Result.

## User Execution Test Scenarios

**Applicability:** not-applicable

INFRA-091 changes only repository-internal verification planning and execution: harness/CI check
ownership, exact verification-receipt reuse, root-manifest impact classification, CI applicability
routing, PTY engineering-test selection, bounded workspace check scheduling, and timing telemetry. It
does not change any shipped Robota CLI, TUI, browser, application, public SDK, or example behavior. The
only runnable observables are build, test, lint, harness, Git-hook, and CI results, which
`.agents/rules/backlog-execution.md` explicitly classifies as engineering/governance verification and
forbids as User Execution evidence. Those observables are covered exclusively by `## Test Plan`; no
product-surface scenario is invented.

Independent scenario-author outcome (2026-08-13): `NOT-APPLICABLE`. Capability reachability is not
waived: this work delivers no user-facing capability or public library seam. Per the pipeline, Mode GATE
and `DONE-GATE-STAGE-2` do not apply.

## Progress

### 2026-08-13

- Measured a roughly 16-minute local gate and identified duplicate harness, 86-scope serial, and PTY costs.
- Completed prior-art research, architecture/adversarial review, GATE-WRITE, and GATE-APPROVAL.
- Implemented the nine criteria in commit `83a878e18`, including exact receipts, semantic root-manifest
  scope, capability-specific CI applicability, bounded full-plan batching, representative PTY coverage,
  named repository-check ownership, and measured summaries.
- RED/GREEN evidence: ten focused harness files passed 264 tests; the complete harness suite passed
  176 files / 3,209 tests; the exhaustive TUI unit owner passed 36 tests; the real PTY suite passed
  23 tests with 3 tmux-only skips.
- `pnpm harness:scan` passed 108 scans with one intentional skip and three advisories.
- The clean exact full gate passed all 11 stages in 8m37.6s. The measured owners were harness-self-test
  3m38.0s, affected-verify 2m17.2s, build 1m29.4s, TUI E2E 36.2s, and all remaining stages 36.8s.

### Done Gate audit — 2026-08-13

- The first independent guardian returned `DONE-GATE-STAGE-1: FAIL`: the three draft scenarios omitted
  the required executability decision, two retained fixture placeholders, and all three attempted to use
  repository harness/CI behavior as a product surface even though engineering verification is explicitly
  inadmissible as User Execution Test Scenario evidence.
- The guardian consequently returned `DONE-GATE-STAGE-2: NON-COMPLIANCE` without judging the recorded
  behavior: Stage 1 had not passed, Scenario 1 named `git push` but recorded a direct pre-push invocation,
  and Scenario 3 recorded a classifier function plus contract tests instead of the drafted command.
- No completion status or archival move was made. Applicability is being returned to the scenario-authoring
  phase so this infrastructure-only work is classified under the rule that actually governs it.

## Decisions

- Preserve stable required jobs and give each substantive check one owner instead of path-filtering jobs away.
- Treat receipts as exact correctness evidence, never as prefix/fuzzy performance cache hits.
- Keep unknown classifier and manifest cases on the broad fail-closed path.
- Preserve package-script ownership and existing concurrency ceilings.

## Blockers

- None.

## Result

All nine criteria are implemented and verified. Exact full-gate evidence can now be reused only for the
same clean pushed object/base/tool/profile identity; broad and ambiguous changes remain fail closed. The
full gate fell from the previously observed roughly 16 minutes to 8m37.6s on this branch, and its summary
now attributes the remaining cost to named stage owners. User Execution Test Scenarios are correctly
not-applicable because the changed surfaces are exclusively engineering/governance verification.
