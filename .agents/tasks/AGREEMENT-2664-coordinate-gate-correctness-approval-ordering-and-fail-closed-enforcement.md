---
title: 'AGREEMENT-2664: Coordinate gate correctness, approval ordering, and fail-closed enforcement'
issue: https://github.com/woojubb/robota/issues/2664
status: in-progress
created: 2026-09-20
priority: critical
urgency: now
area: repository gate evaluation, approval provenance, and checkpoint evidence
depends_on: [AGREEMENT-012, AGREEMENT-013, AGREEMENT-2698]
children:
  - BEHAVIOR-2664
  - PUSH-2664
  - DATA-2664
  - RULE-2582
  - BEHAVIOR-2663
  - RULE-2665
  - RULE-2326
  - RULE-2380
---

# AGREEMENT-2664: Coordinate gate correctness, approval ordering, and fail-closed enforcement

## Current disposition — 2026-09-23

The 2026-09-22 P2 Closeout Amendment and [the subsequent issue #2664 correction](https://github.com/woojubb/robota/issues/2664#issuecomment-5787034571) govern current execution. PR #2827 (`2a4a84631d24243d8dfb8ef75e04d790e8d60d37`) deliberately retired the legacy gate, checkpoint, and recommendation machinery.

The historical eight-child set and its original records are retained exactly as a historical ownership projection. All historical approval/gate/checkpoint instructions below describe that superseded execution model. Current acceptance is the following owner table plus the P2 closeout criteria. `depends_on` preserves the historical external-owner graph; current dependency scope is explicitly narrowed in this table, so AGREEMENT-013 does not require closing unrelated issue #2079 work.

| Owner                                      | Current outcome and evidence                                                                                                                                                                                                                                       | Remaining acceptance                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eight historical children                  | The unchanged L/R manifest contains all eight ordered segments. Six executable scopes were retired by PR #2827; PUSH-2664 retains the stricter develop implementation; RULE-2582 retains the live frontmatter tags contract.                                       | Preserve historical records and R ancestry without restoring retired source.                                                                                |
| AGREEMENT-012 / issue #2066                | SECURITY-003 and SECURITY-004 delivered by PR #2832 (`4a01a8717cc5d5f7f95e524b8620934f47058b98`); fork-model semantics delivered by PR #2838 (`fe48835ca6c53ada790ec61ee1fd00c437441ba1`). The current owner Task is done.                                         | Preserve the owner result; reconcile its stale spec projection.                                                                                             |
| AGREEMENT-013 / retained issue #2075 slice | SEC-021 is done; PR #2838 completes source-aware configured-hook refusal. TRANS-016 was separately implemented in PR #2841 and its v1 fixtures repaired in PR #2843.                                                                                               | issue #2664 consumes the issue #2075 slice only. The broader issue #2079 administrative map remains owned by AGREEMENT-013, whose status stays in-progress. |
| AGREEMENT-2698 / retained issue #2391      | Parent migration is superseded. PR #2827 removed the obsolete stack; PR #2835 (`7f8fcb3409222ac38085c35c56dda1ee2165ce6d`) repairs unavailable review-inspection diagnostics on the surviving path.                                                                | Preserve explicit unavailable-versus-valid-absence behavior; do not revive the retired diagnostic pipeline.                                                 |
| INFRA-2664                                 | PR #2840 (`c014b9966842550b84dd7474862b619a9bcdfdc9`) supplies canonical dispatch resolution. Branch run 35816450450 attempt 2 and OID run 35816452676 attempt 1 resolve the same pair and finish with identical 20 job outcomes (13 success, 7 intentional skip). | Delivered independently; not a ninth historical child.                                                                                                      |
| PERF-2664                                  | Superseded with the removed 128-second/11-context CI contract.                                                                                                                                                                                                     | Preserve old measurements as historical; do not claim a current benchmark success.                                                                          |
| MERGE-2664                                 | Shared helper delivered in PR #2823, then retired by PR #2827. Independent bounded evidence verifies all 16 historical merges are clean and have no own-content delta.                                                                                             | Preserve the historical proof; inspect the deliberate S resolution separately.                                                                              |
| SECRET-2664                                | Fifteen historical findings reduce to five exact recomputed fingerprints; synthetic same-carrier controls detect all eight planted findings.                                                                                                                       | Exact exceptions must land; final D-to-head scan and hosted security must pass before done.                                                                 |
| MAP-2664                                   | This table classifies retained external owners and independent issue-owned rows without changing the eight-child set.                                                                                                                                              | Read back matching parent Task/spec and issue #2664 map before done.                                                                                        |
| BRANCH-2664-P2 / AGREEMENT-2664            | Exact replacement publication and current-develop reconciliation remain the active migration work.                                                                                                                                                                 | Reviewed S with parents [R,D], merge-preserving landing, independent content/ancestry verification, final owner reconciliation, and CLOSED issue #2664.     |

Keep this parent in-progress until P2 final acceptance. D is `fde558ea1b9d09d94b261eb980c96dfb4703201b`; S must preserve R `720eb5e841ba7a5361ac667b9658e034212bb58e` as its first parent and D as its second. The fixed historical manifest is unchanged. This document does not assert future hosted check, final merge, or issue-closure success.

## Objective

Resolve [issue #2664](https://github.com/woojubb/robota/issues/2664) as a cause-aligned initiative.
Deliver the direct approval-ordering and checkpoint defects first, then reconcile the inherited gate,
approval, and orchestration criteria without duplicating work already owned by AGREEMENT-012,
AGREEMENT-013, or AGREEMENT-2698.

## Historical source Ownership

- BEHAVIOR-2664 owns the retained target defect in `gate.mjs approve`.
- PUSH-2664 owns the Git-hook bridge prerequisite discovered after BEHAVIOR-2664 landed; it must
  precede later child publication so their trusted integration-base declaration reaches the guard.
- DATA-2664 owns the later checkpoint-inventory defect recorded on issue #2664.
- RULE-2582, BEHAVIOR-2663, RULE-2665, RULE-2326, and RULE-2380 preserve the exact source-Issue
  outcomes transferred into the umbrella.
- AGREEMENT-012 owns issue #2066; AGREEMENT-013 owns the remaining issue #2075 leaf; AGREEMENT-2698
  owns the issue #2391 diagnostic-first outcome. This initiative depends on those records and does
  not clone them.

## Historical plan

- [ ] TC-01 — Validate every declared child Task against its exact source Issue and dependency order.
- [ ] TC-02 — Deliver the approval-ordering and checkpoint-inventory children before wider governance work.
- [ ] TC-03 — Reconcile inherited source rows against their child or external owner with no duplicate execution record.
- [ ] TC-04 — Verify all child and dependency outcomes, then update the umbrella register with exact delivery evidence.
- [ ] TC-05 — Reconcile issue #2664 only after every retained criterion has a delivered or explicitly terminal owner.
- [ ] TC-06 — Preserve each child's approved scope and route every cross-owner finding to its existing owner.
- [ ] TC-07 — Read back one terminal owner and landing witness for every umbrella register row.

## Children

- [x] BEHAVIOR-2664 — done — `.agents/tasks/completed/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`
- [x] PUSH-2664 — done — `.agents/tasks/completed/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md`
- [x] DATA-2664 — done — `.agents/tasks/completed/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md`
- [x] RULE-2582 — done — `.agents/tasks/completed/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md`
- [x] BEHAVIOR-2663 — done — `.agents/tasks/completed/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md`
- [x] RULE-2665 — done — `.agents/tasks/completed/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md`
- [x] RULE-2326 — done — `.agents/tasks/completed/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`
- [x] RULE-2380 — done — `.agents/tasks/completed/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`

## Historical test Plan

Run the exact Task/spec projection scan, Task lifecycle classification, affected harness tests, and
the GitHub issue-triage read-back after each lifecycle mutation. Final verification compares every
umbrella row with one delivered or explicitly terminal owner and runs the full repository harness scan.

## Recommendation Evidence

- `proposal-reviewer` round 1 returned `REVISE` with 2 unresolved findings: the Task still said five
  completed children, and TC-01 still described all children as lifecycle-open.
- At that prior review checkpoint, the Task and spec were corrected to reflect six terminal children,
  with RULE-2326 and RULE-2380 then remaining open in declared order.
- `proposal-reviewer` round 2 returned `ENDORSE` with 0 unresolved findings for projection digest
  `6440813179e8921e562ac9672c07840afc6f3cfa69cbd83962d8e91077b5fd9f` and endorsement key
  `984135c1e9cf2cf6371db17d67faf3e3c1fc3e58ed7a2eb09c2f9089695e8e06`.
- **Canonical loop run:** `r20260920170106` in
  `.agents/loop-runs/backlog-execution-orchestrator.jsonl`; rounds `[2, 0]`, terminal `converged`.
- Final child-terminal projection review round 1 returned `REVISE` with 1 unresolved finding because
  the prior six-terminal/two-open checkpoint was not explicitly qualified as historical evidence.
- That evidence was qualified as the prior checkpoint state; all eight child rows remain terminal.
- Final child-terminal projection review round 2 returned `ENDORSE` with 0 unresolved findings for
  projection digest `f8c28276d85d769753fbe4a02ab1d995c6b4580ce5683d04fdc1f60026a53aae`
  and endorsement key `46c3dba758ec345ab60c35b526ae03dfb205ec04621cad644cd34809bd46c29e`.
- **Canonical loop run:** `r20260920172525` in
  `.agents/loop-runs/backlog-execution-orchestrator.jsonl`; rounds `[1, 0]`, terminal `converged`.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This agreement coordinates private repository planning, gate tooling, and GitHub records;
it changes no Robota CLI, TUI, browser, public SDK, or installed-package behavior for an end user.
