---
status: approved
type: INFRA
tags: [infra, harness]
lane: L1
---

# INFRA-180: restore the full harness scan to green for issue #2505

Paired with `.agents/tasks/INFRA-180-restore-full-harness-scan-green-for-issue-2505.md`. Arising
from [issue #2505](https://github.com/woojubb/robota/issues/2505).

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository governance and developer-tooling maintenance with no published runtime,
CLI, SDK, UI, or other end-user surface to execute.

## Problem

The local issue snapshot records `pnpm harness:scan -- --context integration` failing on `develop`.
The failure is distributed across stale historical records, scan baselines, and internal helper
boundaries, so the repair must restore the observed contracts without deleting a scan or hiding its
population.

## Prior Art Research

Waived: this is a repository-local harness repair. The governing scan contracts, existing records, and
the issue snapshot are the applicable sources; no external product or protocol determines the result.

## Architecture Review

### Affected Scope

- Harness scan records, baselines, and work-run helper modules.
- Historical Task/spec evidence that currently makes the scan red.

### Alternatives Considered

1. Raise or skip the failing baselines. Pro: fewer edits. Con: hides the defect and weakens the gate.
2. Repair each owning record and helper boundary. Pro: keeps the scan truthful. Con: requires a
   coordinated historical-document and implementation change.

### Decision

Choose the owning-boundary repairs so the full scan becomes green because its inputs are correct,
while its fail-closed checks and measured baselines remain active.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — harness scripts and governance records are listed above.
- [x] Sibling scan 완료 — related scan and work-run helpers were inspected in the local tree.
- [x] 대안 최소 2개 검토 완료 — two alternatives and their trade-offs are recorded above.
- [x] 결정 근거 문서화 완료 — the selected owning-boundary repair is stated above.

## Fallback & Degradation Declaration

None. The repair preserves the existing scan population and fail-closed behavior.

## Solution

Reconcile the records and helper boundaries identified by the issue's full-scan failure, then run the
focused consumers and the full integration scan. Keep every changed record and baseline aligned with
the behavior it documents.

## Completion Criteria

- [ ] TC-01: the affected harness tests pass without changing their consumer assertions.
- [ ] TC-02: the full integration scan exits 0 with no undeclared failures.
- [ ] TC-03: the final pull-request CI scan is successful.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| ----- | --------- | --------------- | ----- |
| TC-01 | unit | focused Vitest suites | Exercise the changed harness consumers. |
| TC-02 | integration | `pnpm harness:scan -- --context integration` | Compare with issue #2505's recorded failure. |
| TC-03 | CI | pull-request checks | Confirm the final pushed head is green. |

## Tasks

- [ ] `.agents/tasks/INFRA-180-restore-full-harness-scan-green-for-issue-2505.md` — todo

## Evidence Log

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-PLAN — `.agents/tasks/INFRA-180-restore-full-harness-scan-green-for-issue-2505.md` is the
  paired Task path and its Task records `SCENARIO DRAFTED: not-applicable | 0`.
