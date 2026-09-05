---
title: 'RULE-025: Enforce issue closure terminal rules'
status: done
created: 2026-09-06
completed: 2026-09-06
priority: medium
urgency: soon
area: repository governance and harness verification
depends_on: []
no-issue: internal repository issue source provided by the user; no GitHub issue number was supplied
---

# RULE-025: Enforce issue closure terminal rules

## Objective

Encode the five closure-rule findings from `/tmp/robota-issues/round2/ISSUE-CLOSURE-RULES.md` in the repository's authoritative rules, gate catalogue, execution skill, and mechanically reachable harness checks.

## Plan

- [x] Define terminal outcomes and the tool-defect closure path in the authoritative documents.
- [x] Add the merged-task terminal-state and gate-self-modification protections.
- [x] Add owning-test selection guidance and the pre-start rejection checklist.
- [x] Register and test every new harness check, then run the affected and full harness verification.
- [x] TC-01: Verify the authoritative lifecycle and rejection rules are present.
- [x] TC-02: Verify tool-defect closure evidence is parseable and auditable.
- [x] TC-03: Verify stale merged Tasks and evaluator/evidence overlap produce findings.
- [x] TC-04: Verify owning-test selection and hermetic classification remain complete.
- [x] TC-05: Verify focused tests and the registered harness verification pass.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work changes repository governance and developer verification machinery only; it introduces no runnable product surface or user-facing behavior for an end user to execute.

Spec: `.agents/spec-docs/done/RULE-025-enforce-issue-closure-terminal-rules.md`

## Test Plan

Run focused harness tests for task lifecycle findings, gate evidence parsing, evaluator overlap, and test classification. Then run `pnpm harness:test:hermetic`, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` against the final tree; record each command's exit status and any pre-existing findings in the paired spec Evidence Log.
