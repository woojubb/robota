---
title: 'CLOSEOUT-2655: Batch verified post-merge delivery records without repeated planning'
issue: https://github.com/woojubb/robota/issues/2655
status: in-progress
created: 2026-09-12
priority: medium
urgency: soon
area: harness closeout
depends_on: []
---

# CLOSEOUT-2655: Batch verified post-merge delivery records without repeated planning

## Objective

Remove the false archive classification and forced isolated ledger commit that reject verified
PR #2709 delivery records. This directly blocks the active #2655 closeout; it is not a new
GitHub issue or an expansion of the remaining artifact and package-boundary outcomes.

Spec: `.agents/spec-docs/active/CLOSEOUT-2655-batch-verified-post-merge-delivery-records-without-repeated-planning.md`

Owner authorization (verbatim): "작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요."

Independent recommendation, 2026-09-12, Carson: REVIEW VERDICT: ENDORSE. Two FOUNDATIONAL causes
are already covered by this plan: path-only archive classification and forced isolated ledger
commits. No enlarged scope or additional Task is required. Scenario author Carson confirmed the
not-applicable verdict below; execution verification remains outstanding.

## Plan

- [ ] Correct archive classification and batch eligibility together in staged/history consumers.
- [ ] Verify the real failing delivery shape and negative cases without local Git fixtures.
- [ ] Synchronize the owner rule and preserve existing verified delivery evidence.

## Test Plan

Run the focused memory-only `post-merge-delivery-records.test.mjs` regression file once per
behavior change, and the final affected scans once. CI owns existing Git-fixture regressions.
Original failing delivery records are preserved in stash `5157c139bb7fb06b08e203dbd485a1ad44ece442`.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes internal repository delivery-record classification only; installed SDK,
CLI and application behavior, configuration and user interactions remain unchanged.
