---
title: 'AGREEMENT-2515: coordinate rolling throughput measurement and bounded intake policy'
issue: https://github.com/woojubb/robota/issues/2515
status: superseded
created: 2026-09-09
priority: critical
urgency: now
area: GitHub intake governance and throughput control
depends_on: []
children: [OBSERVABILITY-2515, RULE-2515]
---

# AGREEMENT-2515: coordinate rolling throughput measurement and bounded intake policy

## Disposition

**Superseded as an execution initiative by GitHub issue #2826.** `OBSERVABILITY-2515` remains delivered and
its repeatable throughput measurement is preserved. `RULE-2515` is superseded as a new mandatory
intake gate: root-cause grouping remains recommended issue-triage guidance, while blocker, security,
and data-correctness findings remain immediately fileable. No rolling metric or paired Task/spec
lifecycle is a prerequisite for deleting known delivery overhead.

## Objective

Keep GitHub issue #2515 as the single external problem record while decomposing its two independent causes
into executable Tasks: a canonical rolling measurement and a bounded policy for non-blocking filing.
The parent owns the shared metric envelope, the child relationship, and the final external lifecycle
decision; it does not absorb the separate nested-command ownership defect in issue #2580.

## Recommendation Gate

**Recommendation: proceed with the two-child decomposition.** The issue is a valid P0 because the
repository currently has neither a repeatable rolling created/closed/net measurement nor a checked-in
policy that reacts to positive net growth. These are independent causes with different failure modes
and verification plans, so one implementation Task would make completion ambiguous. Existing
RULE-019 and `github-issue-triage` remain the owners of issue shape, triage, and conversion; this work
adds only the missing measurement and bounded-intake decisions.

Independent reviews on 2026-09-09 both classified the gap as FOUNDATIONAL and agreed that issue #2580 must
remain separate. The recommendation was revised to the present two-child shape because the review found
that measurement semantics and intake enforcement cannot be independently completed by one Task.

## Children

- [x] OBSERVABILITY-2515 — done — `.agents/tasks/completed/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`
- [x] RULE-2515 — superseded by issue #2826 — `.agents/tasks/RULE-2515-bound-non-blocking-issue-intake-by-measured-net-growth.md`

## Plan

- [x] TC-01 — Establish one canonical `[start,end)` UTC measurement envelope and a failure-visible result
      shape in OBSERVABILITY-2515.
- [x] TC-02 — Superseded: retain grouping guidance and immediate risk exceptions without a new mechanical
      rolling-intake gate.
- [x] TC-03 — Reconciled by issue #2826: delivered measurement retained; mandatory policy/lifecycle work superseded.

## Constraints and Non-goals

- Do not count only current open stock, suppress valid issues, relabel valid issues to improve a metric,
  or use throttling as a substitute for delivery.
- Do not change the independent lifecycle of issue #2580's shared shell parser/ownership contract.
- Do not introduce a parallel label/status system; reuse the existing triage and label ownership.

## Test Plan

- The parent verifies exact source Issue identity, child IDs/paths/statuses, shared measurement-envelope
  consistency, and the final issue/related-issue disposition audit.
- Each child owns its own unit/integration or policy enforcement tests and user-execution evidence.
- Run the affected harness scans plus the repository change loop after each child and before parent
  completion.

## User Execution Test Scenarios

Not applicable — this AGREEMENT owns decomposition and the shared boundary. The child Tasks own the
canonical command and policy-enforcement scenarios.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The parent has no direct runtime or CLI surface; its children own the observable behavior.

## Evidence Log
