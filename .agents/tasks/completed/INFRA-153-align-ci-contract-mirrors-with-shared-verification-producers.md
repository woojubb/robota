---
title: 'INFRA-153: align CI contract mirrors with shared verification producers'
issue: https://github.com/woojubb/robota/issues/2489
status: done
created: 2026-09-03
completed: 2026-09-03
priority: high
urgency: now
area: scripts/harness, .github/workflows, CI contract tests
depends_on: []
---

# INFRA-153: align CI contract mirrors with shared verification producers

## Objective

Align repository contract mirrors with the shared build/quality producer, routed full-scan workflow,
and dynamic CI-equivalent scan arguments introduced by INFRA-151 so the full contract suite is green
without restoring duplicated pull-request work.

## Plan

- [x] TC-01 — Update workflow placement and review-gate contract expectations for routed full scans
      and post-merge CodeQL.
- [x] TC-02 — Parse computed scan arguments in local CI mirrors and fail closed on unsupported dynamic
      expressions.
- [x] TC-03 — Prove the focused mirror suite, distributed large affected route, and complete
      repository-contract suite pass.

## Test Plan

Run the six affected Vitest files together, then run `pnpm harness:test:contracts` to prove every
repository contract agrees with the final workflow structure. The parser tests must cover both the
supported `scan_args` producer and rejection of unrelated dynamic shell expressions.

## Completion Evidence

- Six mirror files under `scripts/harness/__tests__/`: 235 focused tests passed.
- `pnpm harness:test:contracts`: 235 files / 4,788 tests passed.
- Commit `f1aba5e91cd0a8e66f990c66bb4dbbe4009e93fb`: 108 files / 2,526 tests passed
  across four shards in about 115 seconds.

## User Execution Test Scenarios

Not applicable — this changes internal CI contract mirrors and has no runnable product surface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** no user-facing runtime behavior changes; automated repository contracts verify the result.
