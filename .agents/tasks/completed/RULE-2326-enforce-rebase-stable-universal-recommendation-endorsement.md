---
title: 'RULE-2326: Enforce rebase-stable universal recommendation endorsement'
issue: https://github.com/woojubb/robota/issues/2326
status: done
created: 2026-09-20
completed: 2026-09-20
priority: high
urgency: now
area: recommendation approval provenance and gate enforcement
depends_on: [BEHAVIOR-2664]
---

# RULE-2326: Enforce rebase-stable universal recommendation endorsement

## Objective

Require every recommendation approval to carry one subject-bound, rebase-stable independent ENDORSE
with zero unresolved findings, while retaining stricter new-surface review and avoiding invented
historical evidence.

## Source Constraints

- Preserve the issue #2377 requirement that checkpoint identity survive a mandatory rebase.
- Cover both committed and staged recommendation-checkpoint classifiers with mutation-resistant tests.
- Re-govern nonterminal historical work prospectively; do not fabricate reviews for frozen records.

## Plan

- [x] TC-01 — Define a rebase-stable endorsement identity and state the property it preserves.
- [x] TC-02 — Enforce missing, wrong-subject, stale, duplicate, non-ENDORSE, and unresolved records mechanically.
- [x] TC-03 — Add true/false behavioral coverage for committed and staged checkpoint classifiers with red proof.
- [x] TC-04 — Verify rebase survival and the prospective historical-state boundary.

## Test Plan

Run focused recommendation-endorsement, gate-approval, and planning-prelude fixtures before and after a
synthetic rebase. Include an always-true classifier mutation and current nonterminal historical cases,
then run affected harness verification.

## Standing Authorization

**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."

**Given:** 2026-09-20, this conversation.

This authorization covers the recommendation between the rebase-stable subject-plus-projection key,
a whole-commit patch ID, and a bounded ledger rewrite after the alternatives and independent review
are recorded. It does not authorize weakening the independent ENDORSE requirement, fabricating
historical evidence, or bypassing a gate.

## Recommendation Evidence

- Round 1 — `proposal-reviewer`: `REVIEW VERDICT: REVISE`. The subject-plus-projection key and causal
  replay were endorsed in direction, but Completion Criteria checkbox transitions were not yet
  normalized and would have made normal completion invalidate its own key. The bounded correction
  normalizes only checkbox markers while retaining criterion text, TC IDs, order, structure, and the
  immutable planned Test Plan in the endorsed projection.
- Round 2 — `proposal-reviewer`: `REVIEW VERDICT: ENDORSE`; unresolved actionable findings: 0. The
  reviewer verified the correction keeps lifecycle-only checkbox transitions stable, material
  criterion and Test Plan changes bound, execution proof solely in the Evidence Log, adoption unable
  to authorize current approval, and the rebase-stable identity plus causal replay intact.
- Durable evidence — the exact RULE-2326 self-bootstrap tuple (subject, reviewed revision
  `2a5da7ba7651fd4830013743f41dd81a449713f5`, projection digest, and endorsement key) is retained in
  `scripts/harness/recommendation-endorsement-baseline.json`; approved design and completed gate
  evidence are retained in
  `.agents/spec-docs/done/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`.
  Its rebased planning checkpoint landed in `e9be39adb`; enforcement implementation landed in
  `d5cdce3d5`.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes private repository recommendation-review provenance and exposes no Robota CLI,
TUI, browser, public SDK, or installed-package behavior for an end user.
