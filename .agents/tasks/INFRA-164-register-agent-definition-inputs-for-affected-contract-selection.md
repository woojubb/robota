---
title: 'INFRA-164: register agent definition inputs for affected contract selection'
status: todo
created: 2026-09-05
priority: medium
urgency: soon
area: harness contract-test input ownership
depends_on: []
---

# INFRA-164: register agent definition inputs for affected contract selection

## Objective

Remove the unnecessary complete contract-test selection caused by missing agent-definition input ownership and harvesting, without dropping any consumer coverage.

no-issue: Direct owner request to fix the reported inefficient harness behavior.

## Owner Approval

2026-09-05: "잘못된 하네스나 작업 비효율을 유발하는 하네스를 발견하면 나에게 보고하고 개선해. 나는 지금의 목표를 꼭 빠르게 달성해야 하는데 그 목표에 방해되는건 제거해야 하기 때문이야"

The reported concrete bottleneck is unknown ownership of .claude/agents/mechanical-refactor-worker.md, which selected all 248 contracts. The scope is internal selector metadata and two regression files, not a change to product behavior or a waiver of verification.

## Plan

- [ ] TC-01: Agent definition inputs resolve to workspace:governance; unrelated unknown .claude paths retain complete fallback.
- [ ] TC-02: Direct agent file literals and directory consumers enter the registry and select all their affected consumer tests plus the safety floor, rather than only the safety floor.
- [ ] TC-03: Control-plane input changes retain complete selection; existing product selection, isolated tests and unknown-input safety remain unchanged.
- [ ] TC-04: Focused registry/selector regression tests and syntax/import checks exit zero after the missing-coverage cases fail on the original code.

## Test Plan

Use scripts/harness/**tests**/contract-test-inputs.test.mjs and scripts/harness/**tests**/affected-contract-tests.test.mjs. Capture RED for missing agent ownership and missing direct/directory consumer coverage, then implement one coherent correction batch. Assert positive inclusion rather than a reduced count alone; unknown and control-plane inputs must still select complete coverage. Root owns the final integrated verification and initial planning commit.

## Delivery Verification Strategy

The integration owner runs the final full CI-equivalent gate after completion artifacts and receipt closure, before push/merge. This remains mandatory delivery verification, not a TC-04 prerequisite; reuse passing results on unchanged inputs rather than duplicating the full gate.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Author assessment, 2026-09-05: the assigned author read the complete user-execution-scenario-author role and evaluated INFRA-164 before implementation. Its entire effect is repository machinery (contract-test scheduling), not an unreachable product capability. No product surface or executability probe applies; engineering tests are not presented as a user scenario. This assessment confirms the earlier content-authored N/A rather than claiming the role review happened earlier.

**Reason:** This change affects repository-internal contract-test selection metadata, not a shipped CLI, SDK, browser or core package behavior. Real registry and selector regression tests cover the execution-planning boundary; no product user scenario is introduced.
