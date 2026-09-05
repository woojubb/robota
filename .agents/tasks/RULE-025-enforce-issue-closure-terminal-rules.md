---
title: 'RULE-025: Enforce issue closure terminal rules'
status: in-progress
created: 2026-09-06
priority: medium
urgency: soon
area: repository governance and harness verification
depends_on: []
children: []
---

# RULE-025: Enforce issue closure terminal rules

## Objective

Encode the five closure-rule findings from `/tmp/robota-issues/round2/ISSUE-CLOSURE-RULES.md` in the repository's authoritative rules, gate catalogue, execution skill, and mechanically reachable harness checks.

## Plan

- [ ] Define terminal outcomes and the tool-defect closure path in the authoritative documents.
- [ ] Add the merged-task terminal-state and gate-self-modification protections.
- [ ] Add owning-test selection guidance and the pre-start rejection checklist.
- [ ] Register and test every new harness check, then run the affected and full harness verification.
- [ ] TC-01: Verify the authoritative lifecycle and rejection rules are present.
- [ ] TC-02: Verify tool-defect closure evidence is parseable and auditable.
- [ ] TC-03: Verify stale merged Tasks and evaluator/evidence overlap produce findings.
- [ ] TC-04: Verify owning-test selection and hermetic classification remain complete.
- [ ] TC-05: Verify focused tests and the registered harness verification pass.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work changes repository governance and developer verification machinery only; it introduces no runnable product surface or user-facing behavior for an end user to execute.

## Test Plan

Run focused harness tests for task lifecycle findings, gate evidence parsing, evaluator overlap, and test classification. Then run `pnpm harness:test:hermetic`, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` against the final tree; record each command's exit status and any pre-existing findings in the paired spec Evidence Log.
