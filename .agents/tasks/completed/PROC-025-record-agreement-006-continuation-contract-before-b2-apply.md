---
title: 'PROC-025: record AGREEMENT-006 continuation contract before B2 apply'
status: done
created: 2026-08-31
completed: 2026-08-31
priority: medium
urgency: now
area: workflow governance
depends_on: []
---

# PROC-025: record AGREEMENT-006 continuation contract before B2 apply

## Objective

Make the already-approved AGREEMENT-006 B2 continuation mechanically reachable without changing its
approved migration semantics or mutating GitHub. Record the exact continuation artifacts and align the
paired Task lifecycle before a later branch attempts the B2 continuation checkpoint.

no-issue: internal planning-order correction discovered while executing the approved issue #2070
migration; it introduces no new external problem or execution owner.

## Plan

- [x] TC-01: Add exactly one six-path `Continuation artifacts` declaration to AGREEMENT-006 and verify
      the checkpoint-evidence parser returns the exact declared set.
- [x] TC-02: Align the AGREEMENT-006 Task/spec pair at `in-progress` while preserving every prior
      GATE-IMPLEMENT PASS byte and the recorded 2026-08-31 continuation FAIL.
- [x] TC-03: Pass staged/history plan-order and affected scans while proving the five named live Issues
      remain unchanged.

## Test Plan

- Parse the declaration with `scripts/harness/checkpoint-evidence-contract.mjs` and assert the exact six
  repository paths.
- Compare AGREEMENT-006 Task/spec frontmatter and raw prior-PASS digests before and after the correction.
- Run `node scripts/harness/scan-user-execution-plan-order.mjs` against staged and committed transitions.
- Run `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
  and compare authenticated read-only snapshots of issues #2079/#2070/#2085/#2104/#2118.

## User Execution Test Scenarios

Not applicable to this repository-governance correction. The work changes only the AGREEMENT-006
continuation declaration, its paired Task lifecycle state, and preserved gate evidence; it performs no
live GitHub mutation and delivers no runnable Robota product behavior or user-facing surface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Not applicable because parser, plan-order, lifecycle, evidence-preservation, and read-only Issue
checks are engineering verification. They do not expose a Robota CLI command, TUI/browser flow, public SDK
behavior, product output, or product state that a user could execute and observe.

## Result

- AGREEMENT-006 now declares exactly the durable manifest, its active Task/spec pair, and the three child
  Task paths required by the B2 continuation.
- AGREEMENT-006 Task/spec both read `in-progress`; the original GATE-IMPLEMENT PASS bytes remain
  `sha256:3a2af5a39896d43865314f00a858ea69614b62f9807facae12e5e85372c7d043`, and the
  2026-08-31 continuation FAIL remains recorded.
- The checkpoint contract and plan-order suites passed 157/157. Affected verification passed 36 scans
  with the final-receipt-dependent work-run scan explicitly deferred to close-out.
- Authenticated read-back found no body, label, state, assignee, Task-marker, parent/child, or blocked-by
  drift on issues #2079/#2070/#2085/#2104/#2118.
- The recurring first-checkpoint cause is contained under PROC-026 and registered as
  [issue #2561](https://github.com/woojubb/robota/issues/2561); PROC-025 does not claim it fixed.
