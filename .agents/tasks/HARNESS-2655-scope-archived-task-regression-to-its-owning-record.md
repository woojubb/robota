---
title: 'HARNESS-2655: Scope archived-task regression to its owning record'
issue: https://github.com/woojubb/robota/issues/2655
status: todo
created: 2026-09-12
priority: medium
urgency: soon
area: harness regression scope
depends_on: []
---

# HARNESS-2655: Scope archived-task regression to its owning record

## Objective

Repair the archived-record assertion that prevents the legitimate parent conversion for Issue #2655.
Preserve valid original-source citations and collector behavior while narrowing the test to its owner.

Spec: `.agents/spec-docs/todo/HARNESS-2655-scope-archived-task-regression-to-its-owning-record.md`

Owner authorization (verbatim):

> 작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.

## Plan

- [ ] TC-01: Verify archived-record exclusion and legitimate same-Issue discoverability with RED/GREEN evidence.
- [ ] TC-02: Run affected repository scans without expanding their scope or bypassing failures.
- [ ] TC-03: Run the full owning regression file and inspect sibling assertions.

## Test Plan

Run `pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs` and the affected
scan command recorded in the paired spec. Preserve the failing parent-conversion log and exercise
an isolated fixture combining an archived record with a valid open citation.

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
