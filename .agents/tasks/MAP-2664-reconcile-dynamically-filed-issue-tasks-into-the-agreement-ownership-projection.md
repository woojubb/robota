---
title: 'MAP-2664: reconcile dynamically filed issue tasks into the AGREEMENT ownership projection'
issue: https://github.com/woojubb/robota/issues/2664
status: in-progress
created: 2026-09-20
priority: medium
urgency: soon
area: initiative ownership and Issue/Task projection governance
depends_on: []
---

# MAP-2664: reconcile dynamically filed issue tasks into the AGREEMENT ownership projection

## Current disposition — 2026-09-23

The 2026-09-22 P2 Closeout Amendment and [the subsequent issue #2664 correction](https://github.com/woojubb/robota/issues/2664#issuecomment-5787034571) govern current execution.

The bounded current ownership reconciliation is the table below. The original generic filing/approval/mechanical-gate expansion is superseded by the current issue ownership and independent review contract; it is not an unimplemented prerequisite. INFRA, PERF, SECRET, MERGE, MAP and P2 are independent issue-owned rows, not additions to the frozen child set.

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

The repository projection is prepared here. Keep this Task in-progress until the final issue read-back matches it; do not mark a remote write complete from this draft.

## Objective

Define how root Tasks filed from foundational findings during an active AGREEMENT initiative are
classified as children, external owners, or independent issue-owned work, and keep the parent Task,
paired spec, and GitHub Issue/Task map consistent with that decision.

The immediate measured case is `AGREEMENT-2664`: `INFRA-2664` and `PERF-2664` are registered under
issue #2664 but are absent from both the historical eight-child projection and its external-owner map.
Silently adding them as children would change approved scope; leaving them unmapped makes ownership
ambiguous.

## Historical plan

- [ ] Classify `INFRA-2664` and `PERF-2664` against the existing AGREEMENT child boundary.
- [ ] Define the approval consequence when a newly filed root Task expands or only references an initiative.
- [ ] Update the parent Task, paired spec, and GitHub Issue/Task map atomically after that decision.
- [ ] Add mechanical coverage so later foundational filings cannot remain unprojected.

## Evidence

- Finding record: https://github.com/woojubb/robota/issues/2664#issuecomment-5747728265
- Independent aggregate review of
  `origin/develop@f05926ecac6d25ddca74c58aaf6eead8b4dff219..origin/fix/2664-gate-correctness@153a3a412ade7212cae15d9d475b6da47d68c58f`
  reported the unmapped ownership as a SHOULD/FOUNDATIONAL finding.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository-internal initiative ownership and lifecycle projection governance; it
has no runnable Robota product surface, and its behavior is verified through Task/spec/issue contract
tests and repository scans.
