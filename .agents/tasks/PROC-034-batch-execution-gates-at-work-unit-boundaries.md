---
title: 'PROC-034: batch execution gates at work-unit boundaries'
status: in-progress
created: 2026-09-05
priority: critical
urgency: now
area: execution rules and harness planning-order validation
depends_on: []
---

# PROC-034: batch execution gates at work-unit boundaries

## Objective

Recover and deliver the owner-approved execution-cadence amendment and documentation-only atomic planning-order path without procedural fragmentation or weakening product planning, hooks or CI.

no-issue: Direct owner-approved governance amendment and explicit one-time recovery exception.

## Historical Work and Recovery Authority

HISTORICAL, not current completion: the original main worktree implemented the rule amendment and checker before a required L1 planning checkpoint. Its L0 work run 3333 remains unchanged. Prior results were 254/254 combined tests, then 184/184 plan-order tests after reader extraction, and independent review PASS. They do not prove this recovery tree or erase the ordering violation.

2026-09-05 owner instructions: "실행규칙 통합 승인함"; "검사 코드까지 영구 개정해". The owner also requested committing, integrating, pushing and merging into develop; the integration owner retains those operations and their ordinary checks.
After the explicit question about preserving this violation and recovering through a clean tree with a genuine planning checkpoint before reapplication, the owner answered "예외를 승인합니다". This is a one-time PROC-034 historical-order recovery exception, not permission to backdate evidence, disable hooks, waive verification, or grandfather future work.

The preserved patch is /tmp/proc034-approved-recovery.patch, SHA256 ec2c660c7377a15228e636b50fab953f2c9685532c17915e0650903be781044c. The reader is separately preserved at /tmp/proc034-documentation-batch-reader.mjs, SHA256 9efca54b4cb172eea5fd57e44db685a6358fed8466577ee70c580a41832e7901. Recovery run daa29363 was abandoned during planning when owner-rule alignment raised the complete scope to L2; current run 1ae1db70-30e0-4dfe-b2c0-93fdf22f61a7 records actual L2 recovery only. This plan precedes reapplication in this clean tree; it does not pretend to precede the historical implementation.

## Plan

- [ ] TC-01: Reapply the approved cadence amendment as one coherent batch, preserving initial planning, final verification and independent review boundaries.
- [ ] TC-02: Accept an explicitly approved documentation-only Task/change atomic commit in staged and both history paths, without granting ancestor implementation authority.
- [ ] TC-03: Refuse missing approval, non-N/A evidence, ambiguous Tasks, paired specs, executable/symlink files, higher-lane paths, hidden residue and later unplanned product changes.
- [ ] TC-04: Run the complete plan-order and focused governance regression batch, preserve historical RED evidence, and verify syntax, formatting and unchanged file-size ceilings after reapplication.

## Test Plan

Use scripts/harness/**tests**/scan-user-execution-plan-order.test.mjs for positive and refusal cases in staged and committed history, including a later legitimate checkpoint. Run existing depth, agent-definition, enforcement and loop suites once on the integrated batch. Root owns final CI-equivalent verification and publishing. No prior result is promoted to current PASS.

## Deferred Follow-up

The next consolidated harness cycle evaluates duplicate-invocation detection using stable work-unit/input identities. This remains OPEN and is not a prerequisite claimed complete by the documentation-only exception.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work changes repository execution guidance and harness Git-order validation, not a shipped CLI, SDK or browser feature. Deterministic Git fixture regression tests directly verify the changed process boundary; product user scenarios are not applicable.
