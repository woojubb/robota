---
title: 'HARNESS-087: most declared sizes are checked by nothing'
status: todo
created: 2026-08-11
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-087 — most declared sizes are checked by nothing

**Source:** the measured population of the `measurement-provenance` floor when it was adopted.

## The problem

Sixty-one harness modules declare the size of what they examined. Eight export the counter and assert
it; the rest are recorded as pending in `scripts/harness/measurement-provenance-pending.json`. Two
shapes, in roughly equal parts:

- the counter lives in `main()` and is exported by nothing, so no test can read it;
- the counter is exported but its value is asserted by nothing, or by a lower bound.

Every one of those numbers is read as evidence that a scan ran over what it names, and every one can
be wrong by any amount in either direction with the scan still reporting a pass. The ledger makes the
debt visible and keeps it from growing; it does not reduce it.

## Done when

- the `pending` list is empty — every subject sits in `covered` — OR each remaining entry carries a
  reason specific to that scan rather than the shared adoption reason.
- Every migrated scan's counter is incremented at its traversal — not derived from a collection, a
  configuration entry, or a second walk — with the exact-value and after-a-second-run cases the rule
  requires.
- The pass line's covered/unmet split is read as the progress measure while the list shrinks.

## Notes

The floor re-measures both lists on each run, so an entry that comes to meet it is itself a finding
and a covered subject that stops meeting it is a regression: the list cannot silently outlive its
reason or absorb work that used to be checked, and migration order is free. Batching by shape is likely
cheapest — the `main()`-local counters all need the same holder-and-reader extraction that the eight
covered scans already demonstrate.
