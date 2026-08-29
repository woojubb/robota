---
title: 'INFRA-139: Gate judges reject archived Tasks as active'
issue: https://github.com/woojubb/robota/issues/2467
status: done
created: 2026-08-29
priority: high
urgency: now
area: harness gate task-path validation
depends_on: []
---

# INFRA-139: Gate judges reject archived Tasks as active

## Objective

Require GATE-IMPLEMENT and GATE-COMPLETE to judge only the exact active root Task path under
`.agents/tasks/<ID>.md`; archived paths under `.agents/tasks/completed/` or other nested directories
must fail instead of being accepted by existence alone.

## Plan

- [x] Add a regression fixture proving an archived Task path is rejected by both active-task gates.
- [x] Add the equivalent root-path fixture proving valid active Tasks remain accepted.
- [x] Implement canonical root-path validation in `scripts/harness/gate.mjs`.
- [x] Run focused tests, harness scans, and CI-equivalent verification; archive this Task on completion.

## Test Plan

- `scripts/harness/__tests__/gate.test.mjs`: archived-path RED/GREEN fixtures for GATE-IMPLEMENT and
  GATE-COMPLETE, plus existing root-path acceptance.
- `pnpm harness:scan` and `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

Not applicable — internal harness gate correctness; no user-facing runtime flow changes.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: not applicable because this is an internal harness-only gate correction with no user-facing execution path.
