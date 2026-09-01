---
title: 'PROC-026: First GATE-IMPLEMENT checkpoint does not establish continuation-ready Task/spec state'
issue: https://github.com/woojubb/robota/issues/2561
status: done
created: 2026-08-31
completed: 2026-09-01
priority: medium
urgency: soon
area: workflow governance and harness checkpoint lifecycle
depends_on: []
---

# PROC-026: First GATE-IMPLEMENT checkpoint does not establish continuation-ready Task/spec state

## Objective

Make the first L2 GATE-IMPLEMENT checkpoint establish every fact required by a later continuation:
an exact continuation-artifact declaration for sequenced delivery and matching `in-progress` Task/spec
lifecycle state. Today the producer can merge without either fact and the continuation consumer rejects
the already-immutable base only on the next branch.

Observed at `origin/develop` commit `3ca5ab0cc5ab550d80ae3b3e3ae08af657d0bb0f`: AGREEMENT-006's
spec is `in-progress`, its Task is `todo`, and its Decision contains no exact `Continuation artifacts`
declaration. PROC-023 and PROC-024 record the same missing-declaration correction pattern, so this is a
measured recurrence rather than a one-off document error.

## Plan

- [x] Define the first-checkpoint contract for sequenced L2 delivery, including exact declaration timing.
- [x] Make Task/spec activation atomic or fail the checkpoint before either side can drift.
- [x] Add regression coverage proving a merged first checkpoint is continuation-ready and reconcile the
      adjacent native-continuation gap tracked by issue #2422 without duplicating its scope.

## Test Plan

- Exercise the versioned first-checkpoint producer with single and sequenced delivery fixtures.
- Prove paired Task/spec activation succeeds together and refuses both half-transition controls.
- Create a sequenced first checkpoint and immediately consume it as the immutable parent of a native
  continuation fixture.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work changes only the repository contributor-side GATE-IMPLEMENT checkpoint lifecycle
and does not alter any Robota product runtime, CLI, SDK, TUI, browser behavior, or user-observable
product state.

## User Execution Close-out

**User-execution route:** `NOT-APPLICABLE`
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
**Reason:** This work changes only the repository contributor-side GATE-IMPLEMENT checkpoint lifecycle
and does not alter any Robota product runtime, CLI, SDK, TUI, browser behavior, or user-observable
product state.
**DONE-GATE-STAGE-1:** N/A — not invoked; the subject-bound PLAN terminal outcome is `NOT-APPLICABLE`.
**DONE-GATE-STAGE-2:** N/A — not invoked; Phase 4 is skipped for `NOT-APPLICABLE`.

## Result

The rule-owned v2 first-checkpoint form now carries explicit delivery mode and sequenced artifacts, and
new first checkpoints are immediately consumable by the native continuation path. Paired Task/spec
activation is prevalidated and prepared together; half-transition controls are refused. Checkpoint
contract tests passed 20/20 and gate tests passed 76/76, including the first-to-continuation end-to-end
fixture. Issue #2561 carries the truthful local-delivery record and remains open until merge.
