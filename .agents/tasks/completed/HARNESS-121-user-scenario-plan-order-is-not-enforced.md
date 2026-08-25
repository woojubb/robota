---
title: 'HARNESS-121: user-execution scenario PLAN order is not enforced'
issue: https://github.com/woojubb/robota/issues/2327
status: done
created: 2026-08-25
completed: 2026-08-26
priority: high
urgency: soon
area: .agents/rules, .agents/skills, scripts/harness
depends_on: []
---

# HARNESS-121: user-execution scenario PLAN order is not enforced

## Objective

Mechanically prove that user-execution-scenario PLAN reached a valid terminal outcome before
implementation began: applicable work carries a passing written-scenario gate, while not-applicable work
carries the author verdict and reason. HARNESS-119 ran implementation first, then added the mandatory
section and obtained a retrospective not-applicable verdict; final-state scans could not distinguish
that ordering violation from a valid pre-implementation PLAN.

## Plan

- [x] Choose one durable lifecycle signal that binds the author verdict to the work unit and pre-code
      transition without relying on mutable prose or wall-clock inference.
- [x] Make the implementation gate validate a complete Task-bound PLAN outcome and a clean whole
      worktree, then require its PASS to be committed as a planning-only checkpoint before Phase 3.
- [x] Add red/green fixtures for valid applicable/not-applicable ordering, retrospective PLAN,
      missing Stage-1, subject mismatch, ambiguous Tasks, mixed Markdown/code checkpoints, hidden
      unstaged/untracked changes, rename/deletion paths, implementation before later Task/spec
      introduction, and valid versus forged predecessor post-merge ledger preludes.
- [x] Reconcile the user-request, backlog-pipeline, and user-execution orchestrators around the single
      ordering owner.

## Recommendation Review

- Finding depth: `DEPTH: FOUNDATIONAL` — the same retrospective PLAN gap is present in HARNESS-119 and
  CLI-083, while the current section scan, GATE-IMPLEMENT criteria, loop ledger, and pre-commit path do
  not establish a causal boundary.
- Proposal review round 1: `REVIEW VERDICT: REVISE` — remove the circular requirement that
  GATE-IMPLEMENT find its own committed PASS; inspect the whole worktree; require Stage-1 for applicable
  work; define the exact planning allowlist.
- Proposal review round 2: `REVIEW VERDICT: REVISE` — audit from merge-base rather than Task/spec
  introduction and validate the predecessor post-merge ledger as a narrow prelude.
- Proposal review round 3: `REVIEW VERDICT: ENDORSE` — all findings resolved; commit `ea30cb844` is a
  valid append-only predecessor prelude inside the unchanged merge-base audit range.

## Test Plan

- Add focused lifecycle/guardian fixtures for each ordering case and prove the retrospective sequence
  exits non-zero.
- Run the focused contract tests, the complete harness contract tier, and `pnpm harness:scan`.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable. The independent scenario author found that this changes internal repository lifecycle
governance, gate ordering, and harness fixtures only. It delivers no runnable product behavior through
the CLI, TUI, browser, or public SDK, and harness commands are engineering verification rather than
user-execution scenarios. No hidden user-facing capability is introduced behind an internal seam.

## Results

- Added one fail-closed guard for both staged transactions and full topic-branch history, backed by 78
  focused tests and 31 guard-scope contract tests.
- Proved the live HARNESS-121 branch history valid across two topic commits and converged an independent
  local review in round A36 with `ACTIONABLE FINDINGS: 0`.
- `pnpm harness:scan` passed all 144 mandatory scans with 2 declared policy skips.
- `pnpm harness:test:contracts` passed 178 test files and 3,883 tests.
- `pnpm build && pnpm test` completed successfully across the full monorepo.
- On exact committed HEAD after the local-review fix, `pnpm harness:scan` passed 145 scans with 1 declared
  policy skip; the canonical new-rule enforcement declaration, folder/status, Task archival,
  done-evidence, and backlog placement checks all passed.
- The first pre-push gate caught a duplicated frontmatter `status` regex. Replacing it with the owned
  `frontmatterObject`/`asScalar` parser made the focused SSOT/lifecycle/guard suite pass 122/122 and the
  stripped hermetic suite pass 1,149/1,149.
