---
title: 'HARNESS-2655: Scope archived-task regression to its owning record'
issue: https://github.com/woojubb/robota/issues/2655
status: done
created: 2026-09-12
priority: medium
urgency: soon
area: harness regression scope
depends_on: []
completed: 2026-09-12
---

# HARNESS-2655: Scope archived-task regression to its owning record

## Objective

Repair the archived-record assertion that prevents the legitimate parent conversion for Issue #2655.
Preserve valid original-source citations and collector behavior while narrowing the test to its owner.

Spec: `.agents/spec-docs/done/HARNESS-2655-scope-archived-task-regression-to-its-owning-record.md`

Owner authorization (verbatim):

> 작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.

## Plan

- [x] TC-01: Verify archived-record exclusion and legitimate same-Issue discoverability with RED/GREEN evidence.
- [x] TC-02: Run affected repository scans without expanding their scope or bypassing failures.
- [x] TC-03: Run the full owning regression file and inspect sibling assertions.

## Test Plan

Run `pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs` and the affected
scan command recorded in the paired spec. Preserve the failing parent-conversion log and exercise
an isolated fixture combining an archived record with a valid open citation.

Observed RED: `/tmp/robota-2655-archive-regression-red.log` records one failed fixture under the
original Issue-wide assertion. GREEN: `/tmp/robota-2655-archive-regression-green.log` records 122/122
tests passing, including archived citation exclusion, legitimate same-Issue discovery and rejection of
reactivation with no citation or a different Issue. Affected scans passed 61/61 with one declared skip
in `/tmp/robota-2655-archive-regression-scans.log`. Of three Issue-absence assertions in the owning
file, the other two concern controlled resolver-conflict fixtures and do not forbid future live work.

## Delivery

This is a prerequisite repair under Issue #2655, not delivery of its outstanding source outcomes.
Resume the preserved full conversion after the repair is verified on origin/develop; keep the Issue open.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Only internal repository regression assertions change; the installed SDK, CLI and
application interfaces expose no new or modified user interaction.
