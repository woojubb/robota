---
title: 'MERGE-2655: Reconcile post-owner merge verification with empty required-check projection'
issue: https://github.com/woojubb/robota/issues/2655
status: in-progress
created: 2026-09-13
priority: medium
urgency: now
area: post-merge verification guidance
depends_on: []
documentation_batch_approval: DIRECT
documentation_batch_instruction: '작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.'
---

# MERGE-2655: Reconcile post-owner merge verification with empty required-check projection

## Objective

Reconcile independent post-merge CI verification with confirmed empty provider projections and
the existing owner-only control-plane exception. An empty projection must remain visible, but
must not erase actual exact-head check results after a completed merge. This is an L0
documentation-only amendment under the owner's quoted standing instruction; it grants no agent
merge authority. The ordinary empty-projection route requires every applicable declared check
to pass; only the separately documented owner route can account for a red provenance check.

Source: PR #2715, merged by `woojubb` at 2026-09-12T22:16:52Z as
`4f3c0755dd70d3830127ffecdbdc8cb7a9704abc`. Hume independently verified remote ancestry,
identical head/merge tree `022a449a0c887981377b35a7ed3c924af058d773`, all 238 changed paths,
and ten successful non-provenance declared contexts. The verifier nevertheless returned FAIL:
`gh pr checks 2715 --required` reported no required checks; live develop rules returned `[]`.
The provenance failure was expected and the owner's landing record is
https://github.com/woojubb/robota/pull/2715#issuecomment-5649075061.

Pascal's independent depth triage: LOCAL, 0 FOUNDATIONAL of 1. The rule already owns the permitted
owner route; its post-merge relationship and the verifier's unconditional projection refusal are
the two inconsistent statements. Do not change protection, workflows, hooks or product code.

## Plan

- [x] Clarify post-owner landing evidence in the existing Git rule and route the verifier to it.
- [x] Independently check the observed case and refusal cases without repeating product CI.

## Progress

Hume's one local documentation review found one MUST: limiting the empty-projection evidence
route to owner control-plane landings would repeat the same failure after an ordinary merge.
The repair separates confirmed-empty post-merge evidence from the owner-only provenance exception;
it leaves query failures, missing evidence and every other unsuccessful applicable check blocking.
This is the same approved policy-connection repair, not an additional permission or workflow change.

Hume's single repair-batch confirmation returned `ACTIONABLE FINDINGS: 0`. The semantic refusal
matrix retains all unsuccessful/unknown-evidence refusals and the owner-only provenance boundary.
Using the amended local rule and previously verified remote facts, PR #2715 is PASS-eligible;
this does not rewrite the historical FAIL or claim this amendment already landed remotely.
The affected scan selected 51 checks: review-findings initially failed on the revised default
paragraph, then its focused rerun passed after preserving the ordinary evidence contract explicitly.
One reference-kind advisory points to unchanged ARTIFACT task prose and will be handled in its
completion record. Formatting, diff checks and the staged three-path plan-order check passed.
No product test or CI run was repeated, and no semantic-mechanization claim is made.

## Test Plan

Read the amended two-owner relationship and verify the observed PR from exact-head, pre-merge
results. Negative cases: unreadable evidence, absent owner record, non-provenance red/missing/
pending/cancelled/skipped checks, or an unmerged PR must not obtain a landing PASS. Formatting and
affected document scans cover structure only, not remote protection or authorization semantics.
No new mechanical gate is introduced; the existing read-only verifier remains the execution owner.

## Delivery

Include this small supporting amendment in the Issue #2655 workflow. Keep Issue #2655 open for the unfinished
BOUNDARY-2655 work. Preserve the original failed verifier result as evidence rather than rewriting it.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes internal post-merge evidence interpretation only. Installed CLI, browser,
TUI and public SDK interactions are unchanged, so no new runnable product scenario exists.
