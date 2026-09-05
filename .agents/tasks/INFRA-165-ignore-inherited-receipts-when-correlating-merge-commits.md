---
title: 'INFRA-165: ignore inherited receipts when correlating merge commits'
status: todo
created: 2026-09-05
priority: high
urgency: now
area: work-run receipt correlation
depends_on: []
---

# INFRA-165: ignore inherited receipts when correlating merge commits

## Objective

Unblock legitimate integration merges by distinguishing inherited receipt blobs from new receipt closures.

no-issue: Direct owner request to resolve the reported integration blocker.

## Owner Approval

2026-09-05: "잘못된 하네스나 작업 비효율을 유발하는 하네스를 발견하면 나에게 보고하고 개선해". The owner also requested completion through commit, integration, push and develop merge. This child performs scoped implementation and local commits; root owns integration and the single final full gate.

## Plan

- [ ] TC-01: Real merge imports containing multiple unchanged receipts already present in merge parents return no pending terminal receipt correlation.
- [ ] TC-02: A genuinely new receipt, changed receipt or receipt mixed with other closure paths retains existing fail-closed validation.
- [ ] TC-03: Real Git fixture regression is RED on the original implementation, then the work-run hook suite and syntax checks pass after the bounded fix.

## Test Plan

Use `scripts/harness/__tests__/work-run-hook.test.mjs` with real Git merge state and known receipt paths. Prove a four-receipt merge does not become a new closure, while altered/new/mixed closure cases refuse. Run syntax checks and the focused suite; final integrated verification belongs to root after receipt closure, before push.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository-internal commit correlation machinery, not a shipped CLI or SDK capability. Git fixtures verify the process behavior; no product user surface changes.
