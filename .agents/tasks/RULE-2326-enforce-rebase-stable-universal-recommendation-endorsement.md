---
title: 'RULE-2326: Enforce rebase-stable universal recommendation endorsement'
issue: https://github.com/woojubb/robota/issues/2326
status: todo
created: 2026-09-20
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

- [ ] TC-01 — Define a rebase-stable endorsement identity and state the property it preserves.
- [ ] TC-02 — Enforce missing, wrong-subject, stale, duplicate, non-ENDORSE, and unresolved records mechanically.
- [ ] TC-03 — Add true/false behavioral coverage for committed and staged checkpoint classifiers with red proof.
- [ ] TC-04 — Verify rebase survival and the prospective historical-state boundary.

## Test Plan

Run focused recommendation-endorsement, gate-approval, and planning-prelude fixtures before and after a
synthetic rebase. Include an always-true classifier mutation and current nonterminal historical cases,
then run affected harness verification.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes private repository recommendation-review provenance and exposes no Robota CLI,
TUI, browser, public SDK, or installed-package behavior for an end user.
