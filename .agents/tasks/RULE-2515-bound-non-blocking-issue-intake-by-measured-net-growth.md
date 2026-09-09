---
title: 'RULE-2515: bound non-blocking issue intake by measured net growth'
issue: https://github.com/woojubb/robota/issues/2515
status: todo
created: 2026-09-09
priority: critical
urgency: now
area: GitHub issue intake policy
depends_on: [AGREEMENT-2515, OBSERVABILITY-2515]
---

# RULE-2515: bound non-blocking issue intake by measured net growth

## Problem

The repository has no checked-in policy that reacts when rolling issue net growth is positive. Without a
numeric threshold and explicit slow/stop/group actions, non-blocking manifestations can continue to be
filed even while the backlog grows. Existing blocker, security, and data-correctness reporting must
remain immediate-file exceptions.

## Plan

After OBSERVABILITY-2515 establishes the canonical metric envelope, define the threshold and response
policy in the existing issue-intake owner. Enforce duplicate/root-cause grouping for non-blocking
manifestations, make the response mechanical and fail closed, and preserve immediate filing for
blocker/security/data-correctness findings. This Task does not own nested shell command parsing; that
separate foundational contract remains issue #2580.

## Completion Criteria

- [ ] TC-01 — A checked-in policy declares a measurable positive-net threshold and explicit slow/stop/group
  response for non-blocking filings.
- [ ] TC-02 — Duplicate/root-cause grouping is required before filing non-blocking manifestations, while
  blocker/security/data-correctness exceptions remain immediate-file.
- [ ] TC-03 — Tests demonstrate enforcement, exception handling, visible failures, and no suppression,
  relabeling, silent closing, or metric-gaming path.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| ----- | --------- | --------------- | ----- |
| TC-01 | unit | Vitest policy matrix at threshold, below, and above threshold | Assert deterministic action. |
| TC-02 | integration | Intake command/hook fixtures with root-cause and risk classes | Verify exceptions. |
| TC-03 | process integration | Harness scan plus negative-path fixtures | Errors remain visible and non-success. |

## User Execution Test Scenarios

Prerequisites: the canonical measurement fixture and intake-policy fixtures from the child spec. From the
repository root execute a non-blocking filing below the threshold, at the threshold, and above it; verify
the printed action is respectively allow, the declared boundary action, and slow/stop/group. Execute one
blocker, security, and data-correctness filing in the same state and verify each is immediately accepted.
Verify no issue is silently closed, relabeled, or deduplicated. Cleanup removes only temporary fixtures.

Expected: policy decisions are explicit, deterministic, and consistent with the canonical measurement.
Evidence: record exact commands, observable output, and exit codes before completion.

## Tasks

- [ ] Write the child spec and pass GATE-WRITE/GATE-APPROVAL before implementation.
- [ ] Implement with TDD RED → GREEN → REFACTOR.
- [ ] Record TC evidence and pass GATE-IMPLEMENT/GATE-VERIFY/GATE-COMPLETE.

## Evidence Log
