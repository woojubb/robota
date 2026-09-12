---
title: 'META-2655: Permit bounded completion records without executable planning authority'
issue: https://github.com/woojubb/robota/issues/2655
status: todo
created: 2026-09-13
priority: medium
urgency: soon
area: completion-record validation
depends_on: []
---

# META-2655: Permit bounded completion records without executable planning authority

Spec: `.agents/spec-docs/todo/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md`

## Objective

Permit required completion bookkeeping without granting executable planning authority. The current
checker refuses a reviewed documentation-only Task's own archive, a ledger-only record of failed
post-merge verification, and a delivered Task/spec archive accompanied by required parent projections
and execution-run closures. These are observed record-boundary mismatches, not missing product tests.

Supporting Issue #2655; the existing MERGE-2655 amendment records the first refusal. ARTIFACT-2655
already passed GATE-COMPLETE and landed via PR #2715. Its complete closeout is preserved in scoped
stash `f066e47468945c6ff06db347e0ae90eed4f5b322`; no implementation, hook bypass or lost history is
needed to repair the record path. The ordinary executable checkpoint and exact merge proof remain.

Owner authorization (verbatim):

> 작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.

## Plan

- [ ] Reproduce the three metadata refusals with ordinary-file/in-memory fixtures; no local Git fixtures.
- [ ] Extend the existing record classifier and shared staged/history routes with bounded metadata handling.
- [ ] Verify refusal cases, actual staged/history closeout and owner-document consistency; preserve existing executable gates.

## Test Plan

Focused Vitest pure record-classification fixtures establish RED then GREEN without Git fixtures.
Reject executable paths, missing authorization, absent or mismatched archive halves, changed plans
or sealed history, unsupported lifecycle transitions, unrelated parents/runs and missing merge
evidence. Use the current repository's real staged/history checks for wiring verification; remote
CI retains the existing Git-fixture integration suite. No product rebuild is relevant to this fix.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This repairs internal repository record validation only. It adds no CLI, TUI, browser or
public SDK behavior, so there is no new product interaction for a user to execute.
