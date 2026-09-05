---
title: 'INFRA-168: Complete approved Task and spec lifecycle together'
status: in-progress
created: 2026-09-05
priority: medium
urgency: soon
area: harness
depends_on: []
---

# INFRA-168: Complete approved Task and spec lifecycle together

## Objective

Complete a judged Task/spec pair in one native operation, avoiding late status/date/archive/pointer repair and the resulting repeated final verification.

no-issue: Direct user request to improve the measured execution bottleneck.

Spec: `.agents/spec-docs/active/INFRA-168-complete-approved-task-and-spec-lifecycle-together.md`

Instruction (verbatim): 그 개선 작업 끝나면 또 개선해서 지금보다 빠른 작업 속도를 만들기 위해 3시간동안 작업한 세션로그를 확인해서 불필요한 진행이나 잘못된 하네스를 찾아서 개선해줘. 획기적으로 개발시간을 개선해줘

Prior delivery instruction (verbatim): 발견한 절차상의 문제는 바로바로 수정해서 develop에 머지하세요. 하네스가 개선되어야 실제 작업 시간을 혁신적으로 단축시킬 수 있다 그렇기 때문에 하네스부터 올바르게 즉시 수정하는 게 맞다.

## Plan

- [ ] TC-01: Add preflighted completion orchestration using existing gate advancement and Task lifecycle owners.
- [ ] TC-02, TC-03: Protect refusal, historical paths, consistent completion and safe repeat behavior with focused regression tests.
- [ ] TC-04, TC-05: Route completion instructions to the command and finalize evidence before the parent-owned integrated gate.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change affects only repository work-item governance machinery; it adds no shipped product capability, public SDK behavior, or end-user interaction. Engineering fixtures verify the maintenance command instead.

Author role: user-execution-scenario-author, applicability assessed for INFRA-168 on 2026-09-05.

## Test Plan

Focused Vitest integration fixtures in `scripts/harness/__tests__/task-complete.test.mjs` and existing gate advancement tests; native ESM syntax checks. Final integrated verification belongs to the parent after completion artifacts and receipt closure, before push/merge.

## Evidence

Observed historical failure: INFRA-165 source was pushed before terminal metadata; manual archival then required status/date correction and repeated verification. This is prior evidence, not a PASS for INFRA-168.
