---
title: 'MAP-2664: reconcile dynamically filed issue tasks into the AGREEMENT ownership projection'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-20
priority: medium
urgency: soon
area: initiative ownership and Issue/Task projection governance
depends_on: []
---

# MAP-2664: reconcile dynamically filed issue tasks into the AGREEMENT ownership projection

## Objective

Define how root Tasks filed from foundational findings during an active AGREEMENT initiative are
classified as children, external owners, or independent issue-owned work, and keep the parent Task,
paired spec, and GitHub Issue/Task map consistent with that decision.

The immediate measured case is `AGREEMENT-2664`: `INFRA-2664` and `PERF-2664` are registered under
issue #2664 but are absent from both the approved seven-child projection and its external-owner map.
Silently adding them as children would change approved scope; leaving them unmapped makes ownership
ambiguous.

## Plan

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
