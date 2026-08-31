---
title: 'PROC-026: First GATE-IMPLEMENT checkpoint does not establish continuation-ready Task/spec state'
issue: https://github.com/woojubb/robota/issues/2561
status: todo
created: 2026-08-31
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

- [ ] Define the first-checkpoint contract for sequenced L2 delivery, including exact declaration timing.
- [ ] Make Task/spec activation atomic or fail the checkpoint before either side can drift.
- [ ] Add regression coverage proving a merged first checkpoint is continuation-ready and reconcile the
      adjacent native-continuation gap tracked by issue #2422 without duplicating its scope.
