---
title: 'HARNESS-091: canonical completion state and initiative rollup'
status: done
created: 2026-08-14
completed: 2026-08-14
priority: high
urgency: now
area: task lifecycle rules, skills, hooks, and harness scans
depends_on: []
---

# HARNESS-091 — canonical completion state and initiative rollup

**Spec:** [`.agents/spec-docs/done/HARNESS-091-canonical-completion-state-and-initiative-rollup.md`](../../spec-docs/done/HARNESS-091-canonical-completion-state-and-initiative-rollup.md)

## Objective

Make Task frontmatter and folder placement the single executable completion state, derive explicit
initiative child rollups from it, and fail closed when a child is archived without every declaring
initiative being updated atomically.

## Plan

- [x] TC-01: add the shared lifecycle classifier with the complete open/terminal vocabulary, strict terminal
      dates, and body-prose spoof rejection; migrate placement and archival consumers.
- [x] TC-02: add exact AGREEMENT/children pairing and dedicated Task/spec rollup validation across active and
      archived corpora, including premature parent-done and all adversarial fixtures.
- [x] TC-03: align Task README, backlog rule, task-tracking skill, and session hook on the shared lifecycle
      owner and atomic parent projection update.
- [x] TC-04: declare and reconcile AGREEMENT-001's twelve-child rollups while preserving seven genuinely open
      children and treating Plan/Completion Criteria as independent initiative evidence.
- [x] TC-05: run focused RED→GREEN tests, staged auto-fix, live scans, harness scan, and CI-equivalent
      verification; record exact results.

## Test Plan

- Prove RED with lifecycle state/date/body-spoof tables and temporary initiative trees covering missing or
  empty declarations, missing/duplicate pairs and rows, self/nested/prefix IDs, all dispositions, stale
  paths/checks, archived parents, atomic child archival, and premature successful parent completion.
- Prove the session hook delegates classification rather than carrying its own status regex.
- Run the live archival scan before AGREEMENT-001 repair and record the stale completed-child findings; run it
  again after repair and require GREEN with five done and seven open child rows.
- Run focused Vitest suites, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` on the post-fix tree.

## User Execution Test Scenarios

**Applicability:** not-applicable. This is repository-internal lifecycle governance with no shipped product
surface; its observables are engineering tests, hooks, scans, and CI gates.

## Progress

### 2026-08-14

- GATE-WRITE passed after correcting the observed AGREEMENT-001 state and classifying the new metadata field.
- Independent proposal review converged after two revision rounds and returned ENDORSE.
- The user's scope-specific request plus standing reasoned auto-approval satisfied GATE-APPROVAL.
- RED proof: the initial five focused suites failed on the missing lifecycle owner, body-prose and checkbox
  completion inference, hook fork, and stale projection behavior; after implementation, 5 files / 87 tests pass.
- Live reconciliation: task-archival initially failed on missing AGREEMENT-001/PM-027 declarations; after
  repair it passes over 69 active and 779 archived Task files. AGREEMENT-001 now records five `done` and seven
  open children at their canonical paths.
- Historical sweep: 341 pre-canonical archived records were discovered. Their exact count/digest is frozen,
  INFRA-090's retired status spelling was corrected, and HARNESS-092 Task/spec own evidence-backed removal.
- Independent Round A review converged from three findings to `ACTIONABLE FINDINGS: 0`.
- Final verification: `pnpm harness:scan` passed 108 scans with 2 declared skips; `pnpm lint` exited 0 with
  existing warnings; `pnpm harness:verify-like-ci` passed all 11 stages in 4m02.2s. The dominant stage was
  harness-self-test at 3m41.4s; affected verification took 1.2s and selected zero product scopes.

## Decisions

- Child Task frontmatter/folder is canonical; initiative rollups are projections and never write downward.
- Dedicated one-child rows avoid mixed-state authored Plan/Completion Criteria semantics.
- Every declared AGREEMENT child is required; only all-`done` children permit successful parent `done`.

## Blockers

None.

## Result

Canonical Task lifecycle is now frontmatter-only and shared by placement, archival, and session hooks.
AGREEMENT child declarations and exact Task/spec projections fail closed across active and archived corpora,
including premature parent completion. Current initiatives are reconciled, historical metadata debt is
frozen without invented dates under HARNESS-092, and all focused, scan, review, and CI-equivalent gates pass.
