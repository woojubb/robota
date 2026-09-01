---
title: 'HARNESS-134: Give not-applicable reasons one shared structural contract'
issue: https://github.com/woojubb/robota/issues/2261
status: done
created: 2026-09-01
completed: 2026-09-01
priority: medium
urgency: soon
area: harness user-execution PLAN validation
depends_on: []
---

# HARNESS-134: Give not-applicable reasons one shared structural contract

## Objective

Make the rule's not-applicable content requirement a single versioned structural contract consumed by
the Task PLAN gate, plan-order replay, and governed spec-section scan. New records must carry a visible
structured outcome plus a substantive reason; historical records remain governed by an explicit cutover
rather than being silently reinterpreted.

## Plan

- [x] Define distinct exact Task-PLAN and spec-section grammars under one shared reason validator.
- [x] Add an ancestry-derived rule-owned revision/cutover so new or transitioned content is strict without
      reinterpreting untouched immutable history.
- [x] Reject absent, blank, thin, hidden, duplicate, or forbidden engineering-verification exception
      reasons using the rule-owned normalization and substantive thresholds.
- [x] Accept a substantive reason without requiring it to repeat the structured `not-applicable` token.
- [x] Record focused RED→GREEN fixtures and completion evidence in the PROC-029 coordinated work unit.

## Test Plan

- Add exact Task fixtures for structured `not-applicable | 0` with and without the English phrase, plus
  missing, blank, short, hidden-Markdown, and forbidden-verification controls.
- Add governed spec-section fixtures for empty, TODO-only, scenario, reasoned not-applicable, legacy
  baseline, and post-cutover records.
- Run the owning scan suites and the affected harness scan set under the repository-required toolchain.

## User Execution Test Scenarios

Not applicable. This Task changes repository validation rules and does not alter an executable Robota
product surface, public SDK behavior, command output, or user-visible workflow.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Not applicable because the delivered behavior is internal governance validation with no
Robota product action a user can execute or observe.

## User Execution Close-out

**User-execution route:** `NOT-APPLICABLE`
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
**Reason:** Not applicable because the delivered behavior is internal governance validation with no
Robota product action a user can execute or observe.
**DONE-GATE-STAGE-1:** N/A — not invoked; the subject-bound PLAN terminal outcome is `NOT-APPLICABLE`.
**DONE-GATE-STAGE-2:** N/A — not invoked; Phase 4 is skipped for `NOT-APPLICABLE`.

## Result

Task PLAN, plan-order replay, and governed spec-section checks now consume one visible-Markdown reason
contract with exact role-specific forms, normalization, substantive thresholds, forbidden engineering
phrases, and an ancestry-derived cutover. Plan-order passed 142/142, spec-section passed 17/17, and the
dedicated shared-contract helper tests passed. Issue #2261 carries the truthful local-delivery record and
remains open until merge.
