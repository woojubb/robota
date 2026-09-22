---
title: 'RULE-2515: bound non-blocking issue intake by measured net growth'
issue: https://github.com/woojubb/robota/issues/2515
status: superseded
created: 2026-09-09
priority: critical
urgency: now
area: GitHub issue intake policy
depends_on: [AGREEMENT-2515, OBSERVABILITY-2515]
---

# RULE-2515: bound non-blocking issue intake by measured net growth

## Disposition

**Superseded by GitHub issue #2826.** The root-cause and duplicate-grouping intent remains recommended in
the existing issue-triage owner, and blocker/security/data-correctness findings remain immediate.
The proposed threshold-driven mechanical filing gate is retired because it would add another
mandatory procedure to the delivery path that issue #2826 is simplifying.

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

- [x] TC-01 — Superseded: no threshold-driven mandatory filing gate is introduced.
- [x] TC-02 — Retained as recommendation guidance; immediate-file risk exceptions remain unchanged.
- [x] TC-03 — Superseded with the enforcement mechanism; no suppression, relabeling, or silent closing is added.

## Test Plan

| TC-ID | Test Type           | Tool / Approach                                               | Notes                                  |
| ----- | ------------------- | ------------------------------------------------------------- | -------------------------------------- |
| TC-01 | unit                | Vitest policy matrix at threshold, below, and above threshold | Assert deterministic action.           |
| TC-02 | integration         | Intake command/hook fixtures with root-cause and risk classes | Verify exceptions.                     |
| TC-03 | process integration | Harness scan plus negative-path fixtures                      | Errors remain visible and non-success. |

## User Execution Test Scenarios

Prerequisites: the canonical measurement fixture and intake-policy fixtures from the child spec. From the
repository root execute a non-blocking filing below the threshold, at the threshold, and above it; verify
the printed action is respectively allow, the declared boundary action, and slow/stop/group. Execute one
blocker, security, and data-correctness filing in the same state and verify each is immediately accepted.
Verify no issue is silently closed, relabeled, or deduplicated. Cleanup removes only temporary fixtures.

Expected: policy decisions are explicit, deterministic, and consistent with the canonical measurement.
Evidence: record exact commands, observable output, and exit codes before completion.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Task changes repository-internal issue-intake governance and its harness enforcement path; it changes no behavior reachable by a user through the Robota CLI, TUI, browser UI, or public SDK. The policy fixtures are operator maintenance surfaces for repository administration, so no separate user product execution scenario applies.

## Tasks

- [x] Superseded by issue #2826; no child spec, enforcement implementation, or legacy gate transition remains.

## Evidence Log
