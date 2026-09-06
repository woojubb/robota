---
title: 'INFRA-180: restore the full harness scan to green for issue #2505'
issue: https://github.com/woojubb/robota/issues/2505
status: todo
created: 2026-09-06
priority: high
urgency: now
area:
  - scripts/harness
  - .agents/spec-docs
  - .agents/tasks
depends_on: []
---

# INFRA-180: restore the full harness scan to green for issue #2505

## Objective

Resolve the failures recorded in the local issue snapshot `/tmp/robota-issues/round2/issues/2505.md`:
the full harness scan must pass without weakening its existing checks, and the historical records it
examines must remain truthful.

## Plan

- [ ] Reconcile the affected harness records and scan baselines while preserving fail-closed behavior.
- [ ] Run the focused consumers and the full integration scan, then record the CI result.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository governance and developer-tooling maintenance with no published runtime,
CLI, SDK, UI, or other end-user surface to execute.

## Test Plan

Run the affected harness unit suites, the integration scan, and the pull-request CI checks; compare
the final scan result against the issue's recorded red baseline.
